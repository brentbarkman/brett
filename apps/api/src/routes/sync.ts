import { Hono } from "hono";
import { Prisma } from "@brett/api-core";
import { prisma } from "../lib/prisma.js";
import { authMiddleware, type AuthEnv } from "../middleware/auth.js";
import { rateLimiter } from "../middleware/rate-limit.js";
import { fieldLevelMerge } from "../lib/sync-merge.js";
import { SYNC_TABLES, SYNC_TABLE_TO_MODEL, PUSHABLE_ENTITY_TYPES, MUTABLE_FIELDS } from "@brett/types";
import type {
  SyncPullRequest, SyncPullResponse, SyncTableChanges,
  SyncPushRequest, SyncPushResponse, SyncMutation, SyncMutationResult,
  PushableEntityType,
} from "@brett/types";

const CURRENT_PROTOCOL_VERSION = 1;
const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 1000;
const STALE_CURSOR_DAYS = 30;
const MAX_MUTATIONS = 50;
const MAX_BODY_SIZE = 1_048_576; // 1MB

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

    // Validate limit
    const limit = body.limit ?? DEFAULT_LIMIT;
    if (limit < 1 || limit > MAX_LIMIT) {
      return c.json(
        { error: `limit must be between 1 and ${MAX_LIMIT}` },
        400,
      );
    }

    const cursors = body.cursors ?? {};

    // Check for stale cursors (>30 days old)
    for (const cursor of Object.values(cursors)) {
      if (cursor) {
        const cursorDate = new Date(cursor);
        const staleCutoff = new Date(Date.now() - STALE_CURSOR_DAYS * 24 * 60 * 60 * 1000);
        if (cursorDate < staleCutoff) {
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

      // Runtime check — skip if model accessor is invalid
      if (!model || typeof model.findMany !== "function") {
        changes[table] = { upserted: [], deleted: [], hasMore: false };
        continue;
      }

      const cursor = cursors[table] ?? null;

      // Build base where clause for active records.
      // Most models have a direct userId column. ScoutFinding is the exception:
      // ownership goes through scout.userId (a relation filter).
      const ownershipFilter: any =
        table === "scout_findings"
          ? { scout: { userId: user.id } }
          : { userId: user.id };

      // Normal query — soft-delete extension auto-filters deletedAt IS NULL
      const where: any = { ...ownershipFilter };
      if (cursor) {
        where.updatedAt = { gt: new Date(cursor) };
      }

      // Special handling for calendar_events: scope to last 90 days + future
      if (table === "calendar_events") {
        where.startTime = { gte: ninetyDaysAgo };
      }

      // Query active records (upserted)
      const upserted = await model.findMany({
        where,
        orderBy: { updatedAt: "asc" },
        take: limit + 1, // +1 to detect hasMore
      });

      // Query tombstone IDs only (bypasses soft-delete extension via key existence)
      const tombstoneWhere: any = {
        ...ownershipFilter,
        deletedAt: { not: null }, // key exists -> bypasses extension
      };
      if (cursor) {
        tombstoneWhere.updatedAt = { gt: new Date(cursor) };
      }
      // Special handling for calendar_events tombstones
      if (table === "calendar_events") {
        tombstoneWhere.startTime = { gte: ninetyDaysAgo };
      }

      const tombstones = await model.findMany({
        where: tombstoneWhere,
        select: { id: true },
        take: limit,
        orderBy: { updatedAt: "asc" },
      });
      const deleted = tombstones.map((r: any) => r.id);

      // Check pagination
      const hasMore = upserted.length > limit;
      const records = hasMore ? upserted.slice(0, limit) : upserted;

      // Compute new cursor from max updatedAt
      if (records.length > 0) {
        const lastRecord = records[records.length - 1];
        const lastUpdatedAt = lastRecord.updatedAt instanceof Date
          ? lastRecord.updatedAt.toISOString()
          : String(lastRecord.updatedAt);
        newCursors[table] = lastUpdatedAt;
      } else if (cursor) {
        // Preserve existing cursor if no new records
        newCursors[table] = cursor;
      }

      changes[table] = { upserted: records, deleted, hasMore };
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

      // Check idempotency key
      const existing = await prisma.idempotencyKey.findUnique({
        where: { key: mutation.idempotencyKey },
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
        result = {
          idempotencyKey: mutation.idempotencyKey,
          status: "error",
          error: err instanceof Error ? err.message : "Unknown error",
        };
      }

      // Store idempotency key + result (R18: catch only P2002)
      try {
        await prisma.idempotencyKey.create({
          data: {
            key: mutation.idempotencyKey,
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

  // R7: Inject userId from auth context. Client payload NEVER controls userId.
  const data = {
    ...mutation.payload,
    id: mutation.entityId,
    userId,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const record = await model.create({ data });

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
