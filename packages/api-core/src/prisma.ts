import { PrismaClient } from "./generated/client/client.js";
import { PrismaPg } from "@prisma/adapter-pg";

// ── Soft-delete extension ──
// Models that participate in soft delete. The sync protocol needs tombstones
// so the mobile client can remove records locally.
const SOFT_DELETE_MODELS = new Set([
  "Item",
  "List",
  "Attachment",
  "BrettMessage",
  "Scout",
  "ScoutFinding",
  "CalendarEvent",
  "CalendarEventNote",
]);

/** Exported for tests and for the sync pull endpoint to know which models are soft-deleted. */
export const SOFT_DELETE_MODEL_NAMES = [...SOFT_DELETE_MODELS] as const;

/**
 * Returns true if the given model name participates in soft delete.
 * Model names are PascalCase (e.g. "Item", not "item").
 */
function isSoftDeleteModel(model: string | undefined): boolean {
  if (!model) return false;
  return SOFT_DELETE_MODELS.has(model);
}

/**
 * Check whether the caller has explicitly opted in to seeing soft-deleted
 * records by including `deletedAt` as a key in their `where` clause.
 * This uses key-existence (not value-truthiness) so that passing
 * `{ deletedAt: {} }` still counts as an opt-in.
 */
function hasBypassFilter(where: Record<string, unknown> | undefined): boolean {
  if (!where) return false;
  return "deletedAt" in where;
}

function withSoftDelete(basePrisma: PrismaClient) {
  return basePrisma.$extends({
    query: {
      $allModels: {
        async findMany({ model, args, query }) {
          if (isSoftDeleteModel(model) && !hasBypassFilter(args.where as Record<string, unknown>)) {
            args.where = { ...args.where, deletedAt: null };
          }
          return query(args);
        },
        async findFirst({ model, args, query }) {
          if (isSoftDeleteModel(model) && !hasBypassFilter(args.where as Record<string, unknown>)) {
            args.where = { ...args.where, deletedAt: null };
          }
          return query(args);
        },
        async findUnique({ model, args, query }) {
          if (!isSoftDeleteModel(model)) {
            return query(args);
          }
          // Convert findUnique → findFirst so we can add the deletedAt filter.
          // findUnique only accepts unique fields in `where`, but findFirst
          // accepts arbitrary filters.
          //
          // Note: there is no bypass path here. A bypass would call query(args)
          // with deletedAt in the where clause, which Prisma rejects because
          // deletedAt is not a unique field. If you need to find a soft-deleted
          // record by ID, use findFirst with { deletedAt: { not: null } } directly.
          //
          // Decompose compound unique keys (e.g. { userId_name: { userId, name } })
          // into top-level fields for findFirst compatibility.
          const where = args.where as Record<string, unknown>;
          const expandedWhere: Record<string, unknown> = {};
          for (const [key, value] of Object.entries(where)) {
            if (
              value !== null &&
              typeof value === "object" &&
              !Array.isArray(value) &&
              key.includes("_")
            ) {
              // This looks like a compound unique key — spread its fields
              Object.assign(expandedWhere, value);
            } else {
              expandedWhere[key] = value;
            }
          }
          expandedWhere.deletedAt = null;

          // Use the base client to avoid infinite recursion via the extension.
          const modelKey = model.charAt(0).toLowerCase() + model.slice(1);
          const delegate = (basePrisma as any)[modelKey];
          // Copy args but replace where; strip `include` if present since
          // findFirst supports the same include syntax.
          return delegate.findFirst({
            ...args,
            where: expandedWhere,
          });
        },
        async findFirstOrThrow({ model, args, query }) {
          if (isSoftDeleteModel(model) && !hasBypassFilter(args.where as Record<string, unknown>)) {
            args.where = { ...args.where, deletedAt: null };
          }
          return query(args);
        },
        async count({ model, args, query }) {
          if (isSoftDeleteModel(model) && !hasBypassFilter(args.where as Record<string, unknown>)) {
            args.where = { ...args.where, deletedAt: null };
          }
          return query(args);
        },
        async aggregate({ model, args, query }) {
          if (isSoftDeleteModel(model) && !hasBypassFilter(args.where as Record<string, unknown>)) {
            args.where = { ...args.where, deletedAt: null };
          }
          return query(args);
        },
        async groupBy({ model, args, query }) {
          if (isSoftDeleteModel(model) && !hasBypassFilter(args.where as Record<string, unknown>)) {
            args.where = { ...(args as any).where, deletedAt: null };
          }
          return query(args);
        },
        async delete({ model, args, query }) {
          if (!isSoftDeleteModel(model)) {
            return query(args);
          }
          // Convert delete → update(deletedAt)
          const modelKey = model.charAt(0).toLowerCase() + model.slice(1);
          const delegate = (basePrisma as any)[modelKey];
          return delegate.update({
            ...args,
            data: { deletedAt: new Date() },
          });
        },
        async deleteMany({ model, args, query }) {
          if (!isSoftDeleteModel(model)) {
            return query(args);
          }
          // Convert deleteMany → updateMany(deletedAt)
          const modelKey = model.charAt(0).toLowerCase() + model.slice(1);
          const delegate = (basePrisma as any)[modelKey];
          return delegate.updateMany({
            ...args,
            data: { deletedAt: new Date() },
          });
        },
      },
    },
  });
}

// ── Client creation ──

const globalForPrisma = globalThis as unknown as {
  prisma: ReturnType<typeof withSoftDelete> | undefined;
};

function createPrismaClient() {
  const adapter = new PrismaPg({
    connectionString: process.env.DATABASE_URL!,
  });
  const base = new PrismaClient({ adapter });
  return withSoftDelete(base);
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

/**
 * The type of the extended Prisma client (with soft-delete interceptors).
 * Use this instead of `PrismaClient` when accepting the prisma singleton
 * as a parameter — the raw `PrismaClient` type is missing methods added
 * by `$extends`.
 */
export type ExtendedPrismaClient = typeof prisma;

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

// ── HNSW tuning ──

// Tune HNSW recall — runs once per process on first query
let hnswTuned = false;
async function ensureHnswTuning(client: ReturnType<typeof withSoftDelete>) {
  if (hnswTuned) return;
  hnswTuned = true;
  try {
    await client.$executeRawUnsafe("SET hnsw.ef_search = 100");
  } catch {
    // pgvector may not be installed in test environments
  }
}

export async function initPrisma(): Promise<void> {
  await ensureHnswTuning(prisma);
}
