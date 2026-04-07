import { Hono } from "hono";
import { prisma } from "../lib/prisma.js";
import { authMiddleware, type AuthEnv } from "../middleware/auth.js";
import { rateLimiter } from "../middleware/rate-limit.js";
import { SYNC_TABLES, SYNC_TABLE_TO_MODEL } from "@brett/types";
import type { SyncPullRequest, SyncPullResponse, SyncTableChanges } from "@brett/types";

const CURRENT_PROTOCOL_VERSION = 1;
const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 1000;
const STALE_CURSOR_DAYS = 30;

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
  });
