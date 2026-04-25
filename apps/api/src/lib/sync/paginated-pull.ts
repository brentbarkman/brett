/**
 * Single-table keyset-paginated read of a user's rows, returning a strict
 * ordered slice of rows newer than `cursor`, plus `hasMore` and the cursor
 * for the next page.
 *
 * ## Why this exists
 *
 * The original /sync/pull paginated upserts and tombstones in two
 * independent queries with a shared starting cursor, then advanced ONE
 * cursor by max(lastUpsert.updatedAt, lastTombstone.updatedAt). When the
 * two streams' tails fell at different timestamps, every row in the gap
 * was permanently dropped on the next round — the user's app silently
 * showed fewer items than the server held.
 *
 * This function fetches both streams (live + tombstones) for the same
 * user/where/cursor, merges them in `(updatedAt, id)` keyset order, and
 * emits ONE cursor that is the merged-stream tail. There is no third
 * state — every row with `(updatedAt, id) <= cursor` is in this page,
 * every row strictly after is in a future page, no row is in both, no
 * row is in neither. `hasMore` is detected from the merged length, not
 * the per-side length, so it's never wrong.
 *
 * ## Memory bound
 *
 * Each call fetches at most `2 * (limit + 1)` rows from Postgres
 * (`limit + 1` from each of live and tombstone queries). The `+ 1` is
 * needed regardless of which side wins the tail — without it, a tail
 * dominated by one side would lose `hasMore` resolution.
 *
 * ## Caller contract
 *
 * - `prismaModel` must be a soft-delete-aware Prisma model accessor
 *   (Item, List, etc.). Tables without a `deletedAt` column are not
 *   supported — pass `includeTombstones: false` or use a different
 *   read path.
 * - `cursor` from a previous page is opaque to the caller; pass it back
 *   verbatim. `null` means "from the beginning."
 * - `extraWhere` is layered as additional AND clauses. Don't put
 *   `deletedAt` or `userId` in it — internal handling owns those keys.
 * - `includeTombstones: false` is the right setting for view-shaped
 *   reads (like /things) where deleted rows have nothing to display.
 *   /sync/pull replication uses the default `true` so the client can
 *   apply the deletion locally.
 *
 * ## What this function CANNOT detect or surface
 *
 * - **Hard deletes.** A `DELETE FROM <table>` (raw SQL or any path
 *   that bypasses the soft-delete extension) leaves no tombstone, so
 *   no client ever learns the row is gone. Their local mirror keeps
 *   it forever. Production code must always go through the extension
 *   (which converts deletes to soft-deletes) for sync to remain
 *   coherent.
 * - **Rows that age out of an `extraWhere` filter.** E.g.,
 *   /sync/pull's calendar-events 90-day window: an event whose
 *   `startTime` falls outside the window is excluded from BOTH the
 *   live and tombstone queries. A previously-synced event that ages
 *   out becomes a permanent local ghost on the client. This is the
 *   caller's design choice — paginatedPull just respects what
 *   `extraWhere` says.
 */

export type CursorParts = { ts: Date; id: string | null };

export type PaginatedPullArgs = {
  /** Prisma model accessor (e.g. `prisma.item`). Must support `findMany`. */
  prismaModel: { findMany: (args: any) => Promise<any[]> };

  /**
   * Prisma client used to wrap the live + tombstone queries in a
   * single transaction (`$transaction([...])`). Without the transaction,
   * a row's state can change between the two queries — most innocuously
   * appearing in BOTH `upserted` and `deleted` of the same page (the
   * client merges then deletes, net correct), but in pathological
   * timestamp-bump cases it could appear in NEITHER. The transaction
   * gives both queries a consistent snapshot. Optional for
   * back-compatibility; when omitted we fall back to two independent
   * queries, which is correct under low-churn datasets.
   */
  prismaClient?: { $transaction: (queries: any[]) => Promise<any[]> };

  /** Always scoped to a single user. */
  userId: string;

  /**
   * Cursor of the form `"<ISO-8601 timestamp>|<row id>"` or, for clients
   * on the legacy format, just `"<ISO-8601 timestamp>"`. `null` =
   * pull from the beginning.
   */
  cursor: string | null;

  /** Page size. Each call returns at most this many rows in `upserted + deleted`. */
  limit: number;

  /**
   * Additional Prisma `where` clauses, AND-layered onto `userId` and the
   * cursor filter. Use to narrow by status, listId, etc. Do NOT include
   * `deletedAt` here — internal logic owns that key.
   */
  extraWhere?: Record<string, unknown>;

  /**
   * If true (default), tombstones are merged into the keyset stream and
   * returned in `deleted`. If false, only live rows are queried; `deleted`
   * is always empty. View-shaped reads (`/things`) want false; replication
   * (`/sync/pull`) wants true.
   */
  includeTombstones?: boolean;
};

export type PaginatedPullResult<T = any> = {
  /** Live rows in `(updatedAt, id)` ascending order. */
  upserted: T[];
  /** Tombstone IDs in `(updatedAt, id)` ascending order. Empty when `includeTombstones: false`. */
  deleted: string[];
  /** True if at least one row exists with key strictly greater than this page's tail. */
  hasMore: boolean;
  /**
   * Cursor for the next call. Pass back verbatim. `null` means no rows
   * were returned in this page — caller should preserve any prior cursor.
   */
  nextCursor: string | null;
};

const CURSOR_PIPE = "|";

/**
 * Parse a cursor string into `(ts, id)`. Accepts both the new pipe-separated
 * keyset form and the legacy timestamp-only form (`id: null`). Returns
 * `null` for malformed input — callers should treat that as "no cursor"
 * rather than 400-ing, matching the existing /sync/pull tolerance.
 */
export function parseCursor(raw: string | null | undefined): CursorParts | null {
  if (!raw) return null;
  const pipeAt = raw.indexOf(CURSOR_PIPE);
  if (pipeAt === -1) {
    const ts = new Date(raw);
    return Number.isNaN(ts.getTime()) ? null : { ts, id: null };
  }
  const ts = new Date(raw.slice(0, pipeAt));
  if (Number.isNaN(ts.getTime())) return null;
  const id = raw.slice(pipeAt + 1);
  if (id.length === 0) return null;
  return { ts, id };
}

/**
 * Format `(updatedAt, id)` into the canonical wire form. Always emits the
 * pipe form, even though `parseCursor` accepts the legacy form on input.
 */
export function formatCursor(updatedAt: Date | string, id: string): string {
  const iso = updatedAt instanceof Date ? updatedAt.toISOString() : updatedAt;
  return `${iso}${CURSOR_PIPE}${id}`;
}

/**
 * Build the Prisma `where` clause that selects rows strictly after the
 * cursor in `(updatedAt, id)` keyset order. For the legacy timestamp-only
 * form, falls back to a simple `updatedAt > ts` (rows sharing that exact
 * millisecond may be re-fetched, which is harmless — clients upsert
 * idempotently).
 */
function buildCursorClause(c: CursorParts): Record<string, unknown> {
  if (c.id === null) {
    return { updatedAt: { gt: c.ts } };
  }
  return {
    OR: [
      { updatedAt: { gt: c.ts } },
      { AND: [{ updatedAt: c.ts }, { id: { gt: c.id } }] },
    ],
  };
}

/**
 * Compare two rows by `(updatedAt, id)` ascending. Used for the in-memory
 * merge of live + tombstone result sets. Both inputs must already be
 * sorted by this same order; this is the standard 2-way merge step.
 */
function compareKeyset(a: { updatedAt: Date; id: string }, b: { updatedAt: Date; id: string }): number {
  const ta = a.updatedAt instanceof Date ? a.updatedAt.getTime() : new Date(a.updatedAt).getTime();
  const tb = b.updatedAt instanceof Date ? b.updatedAt.getTime() : new Date(b.updatedAt).getTime();
  if (ta !== tb) return ta - tb;
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}

export async function paginatedPull<
  T extends { id: string; updatedAt: Date; deletedAt: Date | null },
>(args: PaginatedPullArgs): Promise<PaginatedPullResult<T>> {
  const { prismaModel, prismaClient, userId, cursor, limit, extraWhere = {}, includeTombstones = true } = args;

  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error(`paginatedPull: limit must be a positive integer (got ${limit})`);
  }
  if (!userId) {
    throw new Error("paginatedPull: userId is required");
  }
  if ("deletedAt" in extraWhere) {
    // Reserve `deletedAt` ownership — it's how we bypass the soft-delete
    // extension for the tombstone query. A caller passing it would
    // either be clobbered (silent) or break the bypass (insidious).
    throw new Error("paginatedPull: extraWhere must not include `deletedAt`");
  }
  if ("userId" in extraWhere) {
    // Reserve `userId` ownership. If a caller passes a different userId,
    // the wrap below would still apply — and we'd happily query someone
    // else's rows. Fail loud rather than expose a defense-in-depth hole
    // for a future refactor.
    throw new Error("paginatedPull: extraWhere must not include `userId`");
  }

  const cursorParts = parseCursor(cursor);
  const cursorClause = cursorParts ? buildCursorClause(cursorParts) : null;

  // Wrap every condition in a single top-level AND so caller-provided
  // `AND` / `OR` clauses (e.g. `things.ts` search) compose cleanly with
  // our own cursor clause without clobbering. The straightforward
  // spread `{ userId, ...extraWhere, AND: [cursor] }` would overwrite a
  // caller's top-level `AND` because object spread can't merge
  // same-key arrays. The wrap below sidesteps that entirely.
  function buildWhere(): Record<string, unknown> {
    const clauses: Array<Record<string, unknown>> = [{ userId }];
    if (Object.keys(extraWhere).length > 0) clauses.push(extraWhere);
    if (cursorClause) clauses.push(cursorClause);
    return clauses.length === 1 ? clauses[0] : { AND: clauses };
  }

  // Build the two findMany argument objects up-front so we can either
  // run them as a $transaction (consistent snapshot) or fall back to
  // two sequential queries when the caller didn't pass a client.
  //
  // Live query — soft-delete extension auto-filters to `deletedAt: null`
  // because the resulting `where` has no top-level `deletedAt` key.
  const liveArgs = {
    where: buildWhere(),
    orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
    take: limit + 1,
  };

  // Tombstone query — `deletedAt: { not: null }` lifted to the OUTER
  // where (not inside the AND) so the soft-delete extension's bypass
  // check (`"deletedAt" in where`) sees it. If we put it inside the
  // AND, the extension would auto-add `deletedAt: null`, contradicting
  // the tombstone filter and silently returning zero rows.
  const deadArgs = includeTombstones
    ? {
        where: { ...buildWhere(), deletedAt: { not: null } },
        orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
        take: limit + 1,
      }
    : null;

  let live: T[];
  let dead: T[];
  if (prismaClient && deadArgs) {
    // Single snapshot for both queries. Eliminates the window where a
    // row's state can shift between live and tombstone reads.
    const [liveRows, deadRows] = await prismaClient.$transaction([
      prismaModel.findMany(liveArgs),
      prismaModel.findMany(deadArgs),
    ]);
    live = liveRows as T[];
    dead = deadRows as T[];
  } else {
    live = (await prismaModel.findMany(liveArgs)) as T[];
    dead = deadArgs ? ((await prismaModel.findMany(deadArgs)) as T[]) : [];
  }

  // Two-way merge by `(updatedAt, id)` ASC. Both inputs are already in
  // that order from Prisma's orderBy, so this is a linear merge.
  const merged: T[] = [];
  let i = 0;
  let j = 0;
  while (i < live.length && j < dead.length) {
    if (compareKeyset(live[i], dead[j]) <= 0) {
      merged.push(live[i++]);
    } else {
      merged.push(dead[j++]);
    }
  }
  while (i < live.length) merged.push(live[i++]);
  while (j < dead.length) merged.push(dead[j++]);

  const hasMore = merged.length > limit;
  const slice: T[] = hasMore ? merged.slice(0, limit) : merged;

  // Classify after slicing — a tombstone in the +1 detection slot must
  // not leak into `deleted`, only the in-page rows count.
  const upserted: T[] = [];
  const deletedIds: string[] = [];
  for (const row of slice) {
    if (row.deletedAt == null) {
      upserted.push(row);
    } else {
      deletedIds.push(row.id);
    }
  }

  const last = slice[slice.length - 1];
  const nextCursor = last ? formatCursor(last.updatedAt, last.id) : null;

  return { upserted, deleted: deletedIds, hasMore, nextCursor };
}
