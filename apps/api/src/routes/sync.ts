import { Hono } from "hono";
import { Prisma } from "@brett/api-core";
import { prisma } from "../lib/prisma.js";
import { authMiddleware, type AuthEnv } from "../middleware/auth.js";
import { rateLimiter } from "../middleware/rate-limit.js";
import { fieldLevelMerge, findMissingBaselines } from "../lib/sync-merge.js";
import { publishSSE } from "../lib/sse.js";
import { detectContentType } from "@brett/utils";
import { runExtraction } from "../lib/content-extractor.js";
import { paginatedPull, parseCursor } from "../lib/sync/paginated-pull.js";
import type {
  SyncPullRequest, SyncPullResponse, SyncTableChanges,
  SyncPushRequest, SyncPushResponse, SyncMutation, SyncMutationResult,
  SyncTable, PushableEntityType,
} from "@brett/types";

// Inline these constants to avoid tsx watch ESM re-export bug with workspace symlinks.
// Source of truth: packages/types/src/sync.ts — keep in sync manually.
const SYNC_TABLES: readonly SyncTable[] = [
  "lists", "items", "calendar_events", "calendar_event_notes",
  "scouts", "scout_findings", "brett_messages", "attachments",
];

const SYNC_TABLE_TO_MODEL: Record<SyncTable, string> = {
  lists: "list",
  items: "item",
  calendar_events: "calendarEvent",
  calendar_event_notes: "calendarEventNote",
  scouts: "scout",
  scout_findings: "scoutFinding",
  brett_messages: "brettMessage",
  attachments: "attachment",
};

const PUSHABLE_ENTITY_TYPES: readonly PushableEntityType[] = ["item", "list", "calendar_event_note"];

const MUTABLE_FIELDS: Record<PushableEntityType, readonly string[]> = {
  item: ["title", "description", "notes", "status", "dueDate", "dueDatePrecision",
         "completedAt", "snoozedUntil", "reminder", "recurrence", "recurrenceRule",
         "listId", "brettObservation", "contentType", "contentStatus"],
  list: ["name", "colorClass", "sortOrder", "archivedAt"],
  calendar_event_note: ["content"],
};

// Fields a client may set on CREATE. Wider than MUTABLE_FIELDS because a
// brand-new row can legitimately set `type`, `source`, `sourceUrl`,
// `calendarEventId`, etc. — they're immutable on the server after creation.
// Keep this explicit: any column not listed here is dropped before the
// Prisma insert. Prior behavior spread `mutation.payload` wholesale, which
// let a client set `userId`, `createdAt`, or relation columns to anything.
const CREATABLE_FIELDS: Record<PushableEntityType, readonly string[]> = {
  item: [
    "type", "source", "sourceId", "sourceUrl",
    "title", "description", "notes",
    "status", "dueDate", "dueDatePrecision", "completedAt", "snoozedUntil",
    "reminder", "recurrence", "recurrenceRule",
    "listId", "brettObservation",
    "contentType", "contentStatus",
  ],
  list: ["name", "colorClass", "sortOrder", "archivedAt"],
  calendar_event_note: ["calendarEventId", "content"],
};

function filterCreatePayload(
  entityType: PushableEntityType,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const allowed = CREATABLE_FIELDS[entityType];
  const out: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key in payload) out[key] = payload[key];
  }
  return out;
}

const CURRENT_PROTOCOL_VERSION = 1;
const MAX_LIMIT = 1000;
const STALE_CURSOR_DAYS = 30;
const MAX_MUTATIONS = 50;
const MAX_BODY_SIZE = 1_048_576; // 1MB

/**
 * Per-table default page sizes. The values are chosen so that the worst
 * realistic per-row payload × per-table limit stays comfortably under
 * 1 MB even for content-heavy users:
 *
 *   - `items` rows can include up to ~5–8 KB of extracted `contentBody`,
 *     so 50 rows ≈ 250–400 KB worst case. Going higher (e.g. 200) risks
 *     a single page exceeding 1 MB on power users.
 *   - `brett_messages` rows include AI assistant responses + citations,
 *     similar size class to items. 50 keeps memory and parse cost sane.
 *   - All other tables hold lightweight metadata (≤1 KB / row), so 200
 *     is comfortable and cuts the round-trip count for power users.
 *
 * If the client sends `body.limit`, it overrides ALL tables — that's
 * the legacy single-limit knob and we keep honoring it for clients on
 * older protocols. Modern clients should omit `limit` so the per-table
 * defaults apply.
 */
const DEFAULT_LIMIT_BY_TABLE: Record<SyncTable, number> = {
  items: 50,
  brett_messages: 50,
  lists: 200,
  calendar_events: 200,
  calendar_event_notes: 200,
  scouts: 200,
  scout_findings: 200,
  attachments: 200,
};

/**
 * Fallback if a new table is added to `SYNC_TABLES` without being added
 * to `DEFAULT_LIMIT_BY_TABLE`. Conservative — the small-table value, so
 * a forgotten content-heavy addition wouldn't accidentally pump 200 rows.
 */
const FALLBACK_DEFAULT_LIMIT = 50;

// Cursor parsing/formatting + keyset-merge pagination live in
// `lib/sync/paginated-pull.ts`. See that file for the wire format and
// the algorithm behind why we don't paginate upserts and tombstones
// independently anymore.

/**
 * Map a thrown error from a /sync/push mutation handler into a public
 * response message safe to send back to the client. Raw Prisma errors
 * include schema details (column names, constraint names, table
 * structure) that should never leave the server — they confirm the
 * existence of soft-deleted records on a guessed id, or hint at
 * internal modelling that an attacker could pivot from.
 *
 * Returns:
 * - `publicMessage` — what the client sees in `result.error`.
 * - `logFull` — true when the caller should log the original error
 *   message server-side. False for benign cases the route handler
 *   already classified (so we don't spam ops with expected outcomes).
 */
function sanitisePushError(err: unknown): { publicMessage: string; logFull: boolean } {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    switch (err.code) {
      case "P2002":
        // Unique constraint violation. Could be a CREATE colliding on
        // an id (whether live or soft-deleted) — either way "duplicate"
        // is the only safe public framing.
        return { publicMessage: "duplicate", logFull: true };
      case "P2025":
        // Record to update/delete not found. Caller-facing equivalent
        // of `not_found` — surface that without leaking the where
        // clause Prisma echoes.
        return { publicMessage: "not_found", logFull: false };
      default:
        // Any other known Prisma error — never echo it.
        return { publicMessage: "database_error", logFull: true };
    }
  }
  if (err instanceof Prisma.PrismaClientValidationError) {
    return { publicMessage: "invalid_payload", logFull: true };
  }
  // Genuinely unknown — keep public message generic.
  return { publicMessage: "internal_error", logFull: true };
}

export const sync = new Hono<AuthEnv>()
  .use("/*", authMiddleware)

  .post("/pull", rateLimiter(120), async (c) => {
    const user = c.get("user");
    const body = await c.req.json<SyncPullRequest>();

    // Validate protocol version
    if (body.protocolVersion !== CURRENT_PROTOCOL_VERSION) {
      return c.json(
        { error: `Unsupported protocol version. Expected ${CURRENT_PROTOCOL_VERSION}, got ${body.protocolVersion}` },
        400,
      );
    }

    // Validate limit. `body.limit`, when present, is a single value that
    // overrides every table's default. Modern clients should omit it and
    // let the per-table defaults apply (see `DEFAULT_LIMIT_BY_TABLE`).
    const overrideLimit = body.limit;
    if (overrideLimit !== undefined && overrideLimit !== null) {
      if (!Number.isInteger(overrideLimit) || overrideLimit < 1 || overrideLimit > MAX_LIMIT) {
        return c.json(
          { error: `limit must be between 1 and ${MAX_LIMIT}` },
          400,
        );
      }
    }

    const cursors = body.cursors ?? {};

    // Check for stale cursors (>30 days old). Handle both the legacy
    // plain-timestamp form and the new `"<ts>|<id>"` keyset form.
    for (const cursor of Object.values(cursors)) {
      if (cursor) {
        const parsed = parseCursor(cursor);
        if (!parsed) {
          return c.json({ error: "Invalid cursor" }, 400);
        }
        const staleCutoff = new Date(Date.now() - STALE_CURSOR_DAYS * 24 * 60 * 60 * 1000);
        if (parsed.ts < staleCutoff) {
          return c.json({
            changes: {},
            cursors: {},
            serverTime: new Date().toISOString(),
            fullSyncRequired: true,
          } satisfies SyncPullResponse, 200);
        }
      }
    }

    const changes: Record<string, SyncTableChanges> = {};
    const newCursors: Record<string, string> = {};

    // Calendar events: scope to last 90 days + future
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    for (const table of SYNC_TABLES) {
      const modelAccessor = SYNC_TABLE_TO_MODEL[table];
      const model = (prisma as any)[modelAccessor];

      // Runtime check — skip if model accessor is invalid (defense against a
      // future SYNC_TABLES entry that doesn't map to a real Prisma model).
      if (!model || typeof model.findMany !== "function") {
        changes[table] = { upserted: [], deleted: [], hasMore: false };
        continue;
      }

      const cursor = cursors[table] ?? null;
      const tableLimit = overrideLimit ?? DEFAULT_LIMIT_BY_TABLE[table] ?? FALLBACK_DEFAULT_LIMIT;

      // Per-table extra filters. Calendar events scope to last 90 days +
      // future to keep mobile from pulling years of historical events.
      const extraWhere: Record<string, unknown> = {};
      if (table === "calendar_events") {
        extraWhere.startTime = { gte: ninetyDaysAgo };
      }

      // Keyset-merged pull: live + tombstones in one ordered stream, single
      // monotonic cursor. See `paginated-pull.ts` for the algorithm and
      // why the previous independent-pagination approach lost rows.
      // Pass `prismaClient` so the live + tombstone queries share a
      // single snapshot — without it, a mutation between the two
      // queries can leave a row in an inconsistent classification
      // for that page.
      const result = await paginatedPull({
        prismaModel: model,
        prismaClient: prisma,
        userId: user.id,
        cursor,
        limit: tableLimit,
        extraWhere,
      });

      changes[table] = {
        upserted: result.upserted,
        deleted: result.deleted,
        hasMore: result.hasMore,
      };
      if (result.nextCursor) {
        newCursors[table] = result.nextCursor;
      } else if (cursor) {
        // Preserve existing cursor when no rows were returned — without
        // this, a temporarily empty page would reset the client to
        // cursor=null and force a fresh full re-walk on the next pull.
        newCursors[table] = cursor;
      }
    }

    const response: SyncPullResponse = {
      changes,
      cursors: newCursors,
      serverTime: new Date().toISOString(),
    };

    return c.json(response, 200);
  })

  .post("/push", rateLimiter(60), async (c) => {
    const user = c.get("user");

    // R19: 1MB body size limit
    const contentLength = c.req.header("content-length");
    if (contentLength && parseInt(contentLength, 10) > MAX_BODY_SIZE) {
      return c.json({ error: "Request body too large (max 1MB)" }, 413);
    }

    const body = await c.req.json<SyncPushRequest>();

    // Validate protocol version
    if (body.protocolVersion !== CURRENT_PROTOCOL_VERSION) {
      return c.json(
        { error: `Unsupported protocol version. Expected ${CURRENT_PROTOCOL_VERSION}, got ${body.protocolVersion}` },
        400,
      );
    }

    // Validate mutations array
    if (!Array.isArray(body.mutations)) {
      return c.json({ error: "mutations must be an array" }, 400);
    }
    if (body.mutations.length > MAX_MUTATIONS) {
      return c.json({ error: `Too many mutations. Max ${MAX_MUTATIONS} per request` }, 400);
    }

    const results: SyncMutationResult[] = [];

    for (const mutation of body.mutations) {
      // Validate entity type against allowlist
      if (!PUSHABLE_ENTITY_TYPES.includes(mutation.entityType as PushableEntityType)) {
        results.push({
          idempotencyKey: mutation.idempotencyKey,
          status: "error",
          error: `Entity type "${mutation.entityType}" is not pushable`,
        });
        continue;
      }

      // Check idempotency key. Scope to user.id so a malicious client can't
      // craft a key that collides with another user's stored mutation and
      // replay the cached response (which includes the full record payload).
      // Keys are still client-generated, but namespaced by the authenticated
      // user on the server side.
      const scopedKey = `${user.id}:${mutation.idempotencyKey}`;
      const existing = await prisma.idempotencyKey.findUnique({
        where: { key: scopedKey },
      });
      if (existing) {
        results.push(existing.response as unknown as SyncMutationResult);
        continue;
      }

      // Convert snake_case entity type to camelCase Prisma accessor
      const modelAccessor = snakeToCamel(mutation.entityType);

      let result: SyncMutationResult;
      try {
        switch (mutation.action) {
          case "CREATE":
            result = await processCreate(modelAccessor, mutation, user.id);
            break;
          case "UPDATE":
            result = await processUpdate(modelAccessor, mutation, user.id);
            break;
          case "DELETE":
            result = await processDelete(modelAccessor, mutation, user.id);
            break;
          default:
            result = {
              idempotencyKey: mutation.idempotencyKey,
              status: "error",
              error: `Unknown action "${mutation.action}"`,
            };
        }
      } catch (err) {
        // Don't leak Prisma's raw error messages to clients — they
        // include schema/column hints (e.g. "Unique constraint failed
        // on the fields: (`id`)") that confirm the existence of
        // soft-deleted rows or expose internal column names. Map known
        // Prisma error codes to stable, sanitised public messages;
        // server logs keep the full detail for ops.
        const sanitised = sanitisePushError(err);
        if (err instanceof Error && sanitised.logFull) {
          console.warn(
            "[sync/push] mutation failed:",
            mutation.action,
            mutation.entityType,
            mutation.entityId,
            err.message,
          );
        }
        result = {
          idempotencyKey: mutation.idempotencyKey,
          status: "error",
          error: sanitised.publicMessage,
        };
      }

      // Store idempotency key + result (R18: catch only P2002)
      try {
        await prisma.idempotencyKey.create({
          data: {
            key: scopedKey,
            response: result as any,
            statusCode: result.status === "error" ? 400 : 200,
          },
        });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
          // Duplicate key — another concurrent request already stored it; safe to ignore
        } else {
          throw err;
        }
      }

      // Notify SSE subscribers (desktop) about the change
      if (result.status === "applied" || result.status === "merged") {
        const eventType = mutation.action === "CREATE" ? "created"
          : mutation.action === "DELETE" ? "deleted" : "updated";
        publishSSE(user.id, {
          type: `${mutation.entityType}.${eventType}` as any,
          payload: { id: mutation.entityId },
        });
      }

      results.push(result);
    }

    const response: SyncPushResponse = {
      results,
      serverTime: new Date().toISOString(),
    };

    return c.json(response, 200);
  });

// ── Helpers ──

/** Convert snake_case to camelCase (e.g. "calendar_event_note" -> "calendarEventNote") */
function snakeToCamel(s: string): string {
  return s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

async function processCreate(
  modelAccessor: string,
  mutation: SyncMutation,
  userId: string,
): Promise<SyncMutationResult> {
  const model = (prisma as any)[modelAccessor];
  if (!model || typeof model.create !== "function") {
    return {
      idempotencyKey: mutation.idempotencyKey,
      status: "error",
      error: `Invalid model accessor: ${modelAccessor}`,
    };
  }

  // R7: Inject userId from auth context, and filter the incoming payload
  // through a per-entity allowlist so a client can't set relation columns or
  // server-owned fields (createdAt, updatedAt, userId, syncStatus…) on
  // create. We then add the server-owned fields back explicitly.
  const entityType = mutation.entityType as PushableEntityType;
  const filteredPayload = filterCreatePayload(entityType, mutation.payload);
  const data: Record<string, unknown> = {
    ...filteredPayload,
    id: mutation.entityId,
    userId,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  // For item content-type creates (e.g. iOS share extension, offline-first
  // captures on mobile), mirror the `POST /things` enrichment so we don't
  // ship items without a contentType / never trigger the extractor. Keeping
  // this here means every content-item create path gets the same treatment
  // regardless of which route it came in on.
  let shouldExtract = false;
  if (
    mutation.entityType === "item" &&
    data.type === "content" &&
    typeof data.sourceUrl === "string" &&
    data.sourceUrl.length > 0
  ) {
    if (typeof data.contentType !== "string" || data.contentType.length === 0) {
      data.contentType = detectContentType(data.sourceUrl);
    }
    data.contentStatus = "pending";
    shouldExtract = true;
  }

  const record = await model.create({ data });

  if (shouldExtract && typeof record.sourceUrl === "string") {
    // Fire-and-forget — extraction runs in the background and writes its
    // result back to the item. Errors are logged inside runExtraction.
    runExtraction(record.id, record.sourceUrl, userId).catch((err) => {
      // eslint-disable-next-line no-console
      console.error("[sync.push] content extraction failed", { itemId: record.id, err });
    });
  }

  return {
    idempotencyKey: mutation.idempotencyKey,
    status: "applied",
    record,
  };
}

async function processUpdate(
  modelAccessor: string,
  mutation: SyncMutation,
  userId: string,
): Promise<SyncMutationResult> {
  const model = (prisma as any)[modelAccessor];
  if (!model || typeof model.findFirst !== "function") {
    return {
      idempotencyKey: mutation.idempotencyKey,
      status: "error",
      error: `Invalid model accessor: ${modelAccessor}`,
    };
  }

  // Fetch record with ownership check
  const currentRecord = await model.findFirst({
    where: { id: mutation.entityId, userId },
  });
  if (!currentRecord) {
    return {
      idempotencyKey: mutation.idempotencyKey,
      status: "not_found",
    };
  }

  const changedFields = mutation.changedFields ?? [];
  const previousValues = mutation.previousValues ?? {};

  // R15: Validate changedFields against MUTABLE_FIELDS allowlist
  const entityType = mutation.entityType as PushableEntityType;
  const allowedFields = MUTABLE_FIELDS[entityType];
  const illegalFields = changedFields.filter((f) => !allowedFields.includes(f));
  if (illegalFields.length > 0) {
    return {
      idempotencyKey: mutation.idempotencyKey,
      status: "error",
      error: `Fields not mutable: ${illegalFields.join(", ")}`,
    };
  }

  // Require a baseline for every declared change. Without one, the
  // field-level merge can't tell whether the client is ahead of or stale
  // against the server, so it used to silently treat the field as
  // conflicted (server-wins) and drop the client's edit. Better to reject
  // up front so buggy clients get a clear signal.
  const missingBaselines = findMissingBaselines(changedFields, previousValues);
  if (missingBaselines.length > 0) {
    return {
      idempotencyKey: mutation.idempotencyKey,
      status: "error",
      error: `Missing previousValues for fields: ${missingBaselines.join(", ")}`,
    };
  }

  // Run field-level merge
  const mergeResult = fieldLevelMerge(
    currentRecord as Record<string, unknown>,
    changedFields,
    mutation.payload,
    previousValues,
  );

  if (mergeResult.conflictedFields.length === changedFields.length) {
    // All fields conflicted — server wins entirely
    return {
      idempotencyKey: mutation.idempotencyKey,
      status: "conflict",
      record: currentRecord,
      conflictedFields: mergeResult.conflictedFields,
    };
  }

  if (!mergeResult.hasChanges) {
    // Nothing to merge (empty changedFields)
    return {
      idempotencyKey: mutation.idempotencyKey,
      status: "applied",
      record: currentRecord,
    };
  }

  // Apply merged fields
  const updated = await model.update({
    where: { id: mutation.entityId },
    data: { ...mergeResult.mergedFields, updatedAt: new Date() },
  });

  if (mergeResult.conflictedFields.length > 0) {
    return {
      idempotencyKey: mutation.idempotencyKey,
      status: "merged",
      record: updated,
      conflictedFields: mergeResult.conflictedFields,
    };
  }

  return {
    idempotencyKey: mutation.idempotencyKey,
    status: "applied",
    record: updated,
  };
}

async function processDelete(
  modelAccessor: string,
  mutation: SyncMutation,
  userId: string,
): Promise<SyncMutationResult> {
  const model = (prisma as any)[modelAccessor];
  if (!model || typeof model.findFirst !== "function") {
    return {
      idempotencyKey: mutation.idempotencyKey,
      status: "error",
      error: `Invalid model accessor: ${modelAccessor}`,
    };
  }

  // Fetch record with ownership check
  const currentRecord = await model.findFirst({
    where: { id: mutation.entityId, userId },
  });
  if (!currentRecord) {
    return {
      idempotencyKey: mutation.idempotencyKey,
      status: "not_found",
    };
  }

  // Soft-delete (prisma extension converts delete -> update(deletedAt))
  await model.delete({ where: { id: mutation.entityId } });

  return {
    idempotencyKey: mutation.idempotencyKey,
    status: "applied",
  };
}
