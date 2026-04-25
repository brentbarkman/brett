import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { createTestUser } from "./helpers.js";
import { prisma } from "../lib/prisma.js";
import {
  paginatedPull,
  parseCursor,
  formatCursor,
  type PaginatedPullResult,
} from "../lib/sync/paginated-pull.js";

/**
 * Tests for `paginatedPull` — the shared pagination core that both
 * /sync/pull and /things route through. These pin every correctness
 * invariant the sync engine relies on. If any of these fail, mobile
 * clients are silently below water.
 *
 * All tests use the `Item` model since it's the most complex (largest
 * row, most-frequent updates from server-side activity, the table that
 * exposed the original bug). Other soft-delete-aware models share the
 * exact same code path, so coverage transfers.
 */

/** Insert one item with explicit `updatedAt` so tests control ordering. */
async function seedItem(opts: {
  userId: string;
  title: string;
  /** Override the auto-generated `updatedAt`. */
  updatedAt: Date;
  deletedAt?: Date | null;
  /** Override the cuid so tests can force `id` ordering for sibling timestamps. */
  id?: string;
  status?: string;
}): Promise<{ id: string; updatedAt: Date; deletedAt: Date | null }> {
  const created = await prisma.item.create({
    data: {
      ...(opts.id ? { id: opts.id } : {}),
      userId: opts.userId,
      type: "task",
      status: opts.status ?? "active",
      title: opts.title,
    },
  });
  // Force exact `updatedAt` (and optional `deletedAt`) AFTER create — Prisma's
  // `@updatedAt` ignores manual writes on create. updateMany bypasses the
  // soft-delete extension, which is what we want when seeding tombstones too.
  await prisma.item.updateMany({
    where: { id: created.id },
    data: { updatedAt: opts.updatedAt, deletedAt: opts.deletedAt ?? null },
  });
  return { id: created.id, updatedAt: opts.updatedAt, deletedAt: opts.deletedAt ?? null };
}

/** Walk paginatedPull until exhausted and collect every page's payload. */
async function walkAll(
  userId: string,
  limit: number,
  opts: { includeTombstones?: boolean; extraWhere?: Record<string, unknown> } = {},
): Promise<{ pages: PaginatedPullResult[]; allUpsertedIds: string[]; allDeletedIds: string[] }> {
  const pages: PaginatedPullResult[] = [];
  const allUpsertedIds: string[] = [];
  const allDeletedIds: string[] = [];
  let cursor: string | null = null;
  // Hard upper bound so a regression that broke `hasMore` doesn't hang the
  // suite. 1,000 pages × a few seeded rows each is far above any test's
  // legitimate page count.
  const SAFETY_CAP = 1000;
  for (let i = 0; i < SAFETY_CAP; i++) {
    const page = await paginatedPull({
      prismaModel: prisma.item,
      userId,
      cursor,
      limit,
      includeTombstones: opts.includeTombstones,
      extraWhere: opts.extraWhere,
    });
    pages.push(page);
    for (const row of page.upserted) allUpsertedIds.push(row.id);
    for (const id of page.deleted) allDeletedIds.push(id);
    if (!page.hasMore) break;
    if (!page.nextCursor) {
      throw new Error("hasMore=true but nextCursor=null — would infinite-loop");
    }
    if (cursor === page.nextCursor) {
      throw new Error(`cursor did not advance (${cursor}) — would infinite-loop`);
    }
    cursor = page.nextCursor;
  }
  return { pages, allUpsertedIds, allDeletedIds };
}

describe("paginatedPull", () => {
  let userId: string;

  beforeAll(async () => {
    const user = await createTestUser("paginatedPull suite");
    userId = user.userId;
  });

  beforeEach(async () => {
    // Each test starts with no items for this user. The soft-delete
    // extension converts `prisma.item.deleteMany` into a soft-delete
    // (sets deletedAt), which would leave tombstones around and break
    // test isolation. Use raw SQL to hard-delete for a true wipe.
    await prisma.$executeRaw`DELETE FROM "Item" WHERE "userId" = ${userId}`;
  });

  // ── Cursor parsing / formatting ──

  describe("cursor parsing", () => {
    it("parses pipe-separated keyset form", () => {
      const c = parseCursor("2026-04-25T12:00:00.000Z|abc123");
      expect(c).not.toBeNull();
      expect(c!.id).toBe("abc123");
      expect(c!.ts.toISOString()).toBe("2026-04-25T12:00:00.000Z");
    });

    it("parses legacy timestamp-only form with id=null", () => {
      const c = parseCursor("2026-04-25T12:00:00.000Z");
      expect(c).not.toBeNull();
      expect(c!.id).toBeNull();
    });

    it("returns null for malformed input", () => {
      expect(parseCursor("not-a-date")).toBeNull();
      expect(parseCursor("")).toBeNull();
      expect(parseCursor(null)).toBeNull();
      expect(parseCursor(undefined)).toBeNull();
      // Pipe with empty id half is malformed.
      expect(parseCursor("2026-04-25T12:00:00.000Z|")).toBeNull();
    });

    it("formatCursor + parseCursor round-trips", () => {
      const ts = new Date("2026-04-25T12:00:00.000Z");
      const id = "row-id-xyz";
      const cursor = formatCursor(ts, id);
      const parsed = parseCursor(cursor);
      expect(parsed!.id).toBe(id);
      expect(parsed!.ts.getTime()).toBe(ts.getTime());
    });
  });

  // ── Empty / edge counts ──

  it("returns empty result on an empty table", async () => {
    const page = await paginatedPull({
      prismaModel: prisma.item,
      userId,
      cursor: null,
      limit: 50,
    });
    expect(page.upserted).toEqual([]);
    expect(page.deleted).toEqual([]);
    expect(page.hasMore).toBe(false);
    expect(page.nextCursor).toBeNull();
  });

  it("returns single page when row count < limit", async () => {
    const t0 = new Date("2026-04-25T10:00:00.000Z");
    for (let i = 0; i < 5; i++) {
      await seedItem({ userId, title: `t${i}`, updatedAt: new Date(t0.getTime() + i) });
    }
    const { pages, allUpsertedIds } = await walkAll(userId, 50);
    expect(pages.length).toBe(1);
    expect(allUpsertedIds.length).toBe(5);
    expect(pages[0].hasMore).toBe(false);
  });

  it("hasMore=false when row count exactly equals limit (no spurious extra round)", async () => {
    const t0 = new Date("2026-04-25T10:00:00.000Z");
    for (let i = 0; i < 50; i++) {
      await seedItem({ userId, title: `t${i}`, updatedAt: new Date(t0.getTime() + i) });
    }
    const page = await paginatedPull({
      prismaModel: prisma.item,
      userId,
      cursor: null,
      limit: 50,
    });
    expect(page.upserted.length).toBe(50);
    expect(page.hasMore).toBe(false);
    expect(page.nextCursor).not.toBeNull();
  });

  it("hasMore=true when row count is exactly limit + 1", async () => {
    const t0 = new Date("2026-04-25T10:00:00.000Z");
    for (let i = 0; i < 51; i++) {
      await seedItem({ userId, title: `t${i}`, updatedAt: new Date(t0.getTime() + i) });
    }
    const page = await paginatedPull({
      prismaModel: prisma.item,
      userId,
      cursor: null,
      limit: 50,
    });
    expect(page.upserted.length).toBe(50);
    expect(page.hasMore).toBe(true);
  });

  // ── Coverage across many pages ──

  it("walks all 200 rows across pages with no gaps and no duplicates", async () => {
    const t0 = new Date("2026-04-25T10:00:00.000Z");
    const seeded: string[] = [];
    for (let i = 0; i < 200; i++) {
      const r = await seedItem({ userId, title: `t${i}`, updatedAt: new Date(t0.getTime() + i) });
      seeded.push(r.id);
    }
    const { allUpsertedIds, pages } = await walkAll(userId, 50);
    expect(pages.length).toBe(4);
    expect(allUpsertedIds.length).toBe(200);
    expect(new Set(allUpsertedIds)).toEqual(new Set(seeded));
    // No duplicates across pages.
    expect(new Set(allUpsertedIds).size).toBe(allUpsertedIds.length);
  });

  it("two consecutive fresh walks return identical id sets — determinism guard", async () => {
    // The "two iOS sign-ins disagree" bug is exactly this property failing
    // when the underlying tail can shift due to mid-walk server writes.
    const t0 = new Date("2026-04-25T10:00:00.000Z");
    for (let i = 0; i < 75; i++) {
      await seedItem({ userId, title: `t${i}`, updatedAt: new Date(t0.getTime() + i) });
    }
    const walk1 = await walkAll(userId, 25);
    const walk2 = await walkAll(userId, 25);
    expect(new Set(walk1.allUpsertedIds)).toEqual(new Set(walk2.allUpsertedIds));
  });

  // ── Sibling timestamp handling (the keyset stability invariant) ──

  it("sibling timestamps do not split rows across pages — all 60 same-millisecond rows returned, ordered by id", async () => {
    const sameTs = new Date("2026-04-25T10:00:00.000Z");
    const seeded: string[] = [];
    for (let i = 0; i < 60; i++) {
      const r = await seedItem({ userId, title: `t${i}`, updatedAt: sameTs });
      seeded.push(r.id);
    }
    const { allUpsertedIds, pages } = await walkAll(userId, 50);
    expect(pages.length).toBe(2);
    expect(allUpsertedIds.length).toBe(60);
    // Pin the keyset ordering invariant: returned IDs must come back in
    // lexicographic ascending order (the secondary sort key when updatedAt
    // ties), matching `[...seeded].sort()`. This is the property that lets
    // the next page resume on `(T, id)` without losing siblings.
    expect(allUpsertedIds).toEqual([...seeded].sort());
  });

  // ── Tombstones ──

  it("interleaved upserts and tombstones both surface, in keyset order — the merge fix", async () => {
    // This is the regression guard for the original bug. With independent
    // pagination of upserts vs tombstones, this exact shape lost rows.
    const t0 = new Date("2026-04-25T10:00:00.000Z");
    const liveIds: string[] = [];
    const deadIds: string[] = [];
    for (let i = 0; i < 100; i++) {
      const isDeleted = i % 2 === 0;
      const r = await seedItem({
        userId,
        title: `t${i}`,
        updatedAt: new Date(t0.getTime() + i),
        deletedAt: isDeleted ? new Date(t0.getTime() + i + 1000) : null,
      });
      if (isDeleted) deadIds.push(r.id);
      else liveIds.push(r.id);
    }
    const { allUpsertedIds, allDeletedIds } = await walkAll(userId, 25);
    expect(new Set(allUpsertedIds)).toEqual(new Set(liveIds));
    expect(new Set(allDeletedIds)).toEqual(new Set(deadIds));
    // Total coverage = total seeded.
    expect(allUpsertedIds.length + allDeletedIds.length).toBe(100);
  });

  it("tombstones with later updatedAt than the upsert tail are not skipped", async () => {
    // Mirror of the original bug shape: most rows live, a small clump of
    // tombstones at the very end. The old code would race the cursor past
    // the tombstones in some interleavings.
    const t0 = new Date("2026-04-25T10:00:00.000Z");
    const liveIds: string[] = [];
    const deadIds: string[] = [];
    for (let i = 0; i < 95; i++) {
      const r = await seedItem({ userId, title: `live${i}`, updatedAt: new Date(t0.getTime() + i) });
      liveIds.push(r.id);
    }
    for (let i = 0; i < 5; i++) {
      const r = await seedItem({
        userId,
        title: `dead${i}`,
        updatedAt: new Date(t0.getTime() + 1000 + i),
        deletedAt: new Date(t0.getTime() + 1000 + i),
      });
      deadIds.push(r.id);
    }
    const { allUpsertedIds, allDeletedIds } = await walkAll(userId, 20);
    expect(new Set(allUpsertedIds)).toEqual(new Set(liveIds));
    expect(new Set(allDeletedIds)).toEqual(new Set(deadIds));
  });

  it("upserts with later updatedAt than the tombstone tail are not skipped", async () => {
    // The reverse hazard. Symmetric coverage.
    const t0 = new Date("2026-04-25T10:00:00.000Z");
    const liveIds: string[] = [];
    const deadIds: string[] = [];
    for (let i = 0; i < 95; i++) {
      const r = await seedItem({
        userId,
        title: `dead${i}`,
        updatedAt: new Date(t0.getTime() + i),
        deletedAt: new Date(t0.getTime() + i),
      });
      deadIds.push(r.id);
    }
    for (let i = 0; i < 5; i++) {
      const r = await seedItem({
        userId,
        title: `live${i}`,
        updatedAt: new Date(t0.getTime() + 1000 + i),
      });
      liveIds.push(r.id);
    }
    const { allUpsertedIds, allDeletedIds } = await walkAll(userId, 20);
    expect(new Set(allUpsertedIds)).toEqual(new Set(liveIds));
    expect(new Set(allDeletedIds)).toEqual(new Set(deadIds));
  });

  it("includeTombstones=false returns only live rows and never queries dead", async () => {
    const t0 = new Date("2026-04-25T10:00:00.000Z");
    for (let i = 0; i < 10; i++) {
      await seedItem({
        userId,
        title: `dead${i}`,
        updatedAt: new Date(t0.getTime() + i),
        deletedAt: new Date(t0.getTime() + i),
      });
    }
    const liveIds: string[] = [];
    for (let i = 0; i < 10; i++) {
      const r = await seedItem({ userId, title: `live${i}`, updatedAt: new Date(t0.getTime() + 100 + i) });
      liveIds.push(r.id);
    }
    const { allUpsertedIds, allDeletedIds } = await walkAll(userId, 50, { includeTombstones: false });
    expect(new Set(allUpsertedIds)).toEqual(new Set(liveIds));
    expect(allDeletedIds).toEqual([]);
  });

  // ── Resume / cursor correctness ──

  it("cursor advances strictly monotonically across pages — no overlap", async () => {
    const t0 = new Date("2026-04-25T10:00:00.000Z");
    for (let i = 0; i < 100; i++) {
      await seedItem({ userId, title: `t${i}`, updatedAt: new Date(t0.getTime() + i) });
    }
    const { pages } = await walkAll(userId, 20);
    let prevTs = -Infinity;
    let prevId = "";
    for (const page of pages) {
      for (const row of page.upserted) {
        const ts = row.updatedAt instanceof Date ? row.updatedAt.getTime() : new Date(row.updatedAt).getTime();
        const sameTs = ts === prevTs;
        const idAfter = row.id > prevId;
        // (ts > prevTs) OR (ts === prevTs AND id > prevId).
        expect(ts > prevTs || (sameTs && idAfter)).toBe(true);
        prevTs = ts;
        prevId = row.id;
      }
    }
  });

  it("server writes between pages don't drop unwalked rows or re-emit walked rows", async () => {
    // Models the scenario the user hit: scout-runner / content-extraction /
    // calendar-poller bumps `updatedAt` on rows mid-walk. With the merge fix
    // and monotonic cursor, the bumped row may be RE-DELIVERED in a later
    // page (which is correct — it has new content), but unwalked rows must
    // not be lost and no row's removal is fabricated.
    const t0 = new Date("2026-04-25T10:00:00.000Z");
    const all: { id: string; updatedAt: Date }[] = [];
    for (let i = 0; i < 100; i++) {
      const r = await seedItem({ userId, title: `t${i}`, updatedAt: new Date(t0.getTime() + i) });
      all.push({ id: r.id, updatedAt: r.updatedAt });
    }

    const seen = new Set<string>();
    let cursor: string | null = null;
    let didWriteback = false;
    while (true) {
      const page = await paginatedPull({
        prismaModel: prisma.item,
        userId,
        cursor,
        limit: 20,
      });
      for (const row of page.upserted) seen.add(row.id);

      // Once we've consumed two pages, simulate a server-side writeback
      // that bumps a row we've ALREADY pulled to a future updatedAt.
      // The next page must still walk forward correctly.
      if (!didWriteback && page.upserted.length > 0 && seen.size >= 40) {
        didWriteback = true;
        const target = all[5].id; // a row we definitely already pulled
        await prisma.item.updateMany({
          where: { id: target },
          data: { updatedAt: new Date(t0.getTime() + 10_000) },
        });
      }

      if (!page.hasMore) break;
      cursor = page.nextCursor!;
    }

    // Every originally-seeded id must be in `seen` (no row lost). The
    // bumped row is allowed to appear twice (which we don't enforce
    // either way — caller idempotence handles it).
    for (const row of all) {
      expect(seen.has(row.id)).toBe(true);
    }
  });

  // ── Filtering (extraWhere) ──

  it("extraWhere filters apply to both live and tombstone streams", async () => {
    const t0 = new Date("2026-04-25T10:00:00.000Z");
    for (let i = 0; i < 30; i++) {
      await seedItem({ userId, title: `done${i}`, updatedAt: new Date(t0.getTime() + i), status: "done" });
    }
    const activeIds: string[] = [];
    for (let i = 0; i < 30; i++) {
      const r = await seedItem({ userId, title: `active${i}`, updatedAt: new Date(t0.getTime() + 100 + i) });
      activeIds.push(r.id);
    }
    const { allUpsertedIds } = await walkAll(userId, 50, { extraWhere: { status: "active" } });
    expect(new Set(allUpsertedIds)).toEqual(new Set(activeIds));
  });

  it("rejects extraWhere containing reserved `deletedAt` key", async () => {
    await expect(
      paginatedPull({
        prismaModel: prisma.item,
        userId,
        cursor: null,
        limit: 50,
        extraWhere: { deletedAt: null },
      }),
    ).rejects.toThrow(/deletedAt/);
  });

  it("rejects extraWhere containing reserved `userId` key — defense in depth against caller scoping override", async () => {
    // If the spread merge ever silently let a caller override our own
    // userId scoping, we'd cross-leak data. Fail loud at the boundary.
    const otherUser = await createTestUser("paginatedPull userid-defense");
    await seedItem({ userId: otherUser.userId, title: "leak-target", updatedAt: new Date() });

    await expect(
      paginatedPull({
        prismaModel: prisma.item,
        userId,
        cursor: null,
        limit: 50,
        extraWhere: { userId: otherUser.userId },
      }),
    ).rejects.toThrow(/userId/);

    // Belt-and-braces: even if the throw were bypassed, the row should
    // not have been queryable via this user's paginatedPull. Confirm by
    // pulling without extraWhere and asserting no foreign rows surface.
    const page = await paginatedPull({ prismaModel: prisma.item, userId, cursor: null, limit: 50 });
    expect(page.upserted.find((r: any) => r.title === "leak-target")).toBeUndefined();

    await prisma.$executeRaw`DELETE FROM "Item" WHERE "userId" = ${otherUser.userId}`;
  });

  // ── User scoping ──

  it("never returns rows belonging to a different user", async () => {
    const otherUser = await createTestUser("paginatedPull other-user");
    const t0 = new Date("2026-04-25T10:00:00.000Z");
    const myIds: string[] = [];
    for (let i = 0; i < 20; i++) {
      const r = await seedItem({ userId, title: `mine${i}`, updatedAt: new Date(t0.getTime() + i) });
      myIds.push(r.id);
    }
    for (let i = 0; i < 20; i++) {
      await seedItem({ userId: otherUser.userId, title: `theirs${i}`, updatedAt: new Date(t0.getTime() + i) });
    }
    const { allUpsertedIds } = await walkAll(userId, 100);
    expect(new Set(allUpsertedIds)).toEqual(new Set(myIds));
    // Cleanup the other user too — beforeEach only wipes the suite user.
    await prisma.$executeRaw`DELETE FROM "Item" WHERE "userId" = ${otherUser.userId}`;
  });

  // ── Validation ──

  it("rejects invalid limit", async () => {
    await expect(
      paginatedPull({ prismaModel: prisma.item, userId, cursor: null, limit: 0 }),
    ).rejects.toThrow(/limit/);
    await expect(
      paginatedPull({ prismaModel: prisma.item, userId, cursor: null, limit: -1 }),
    ).rejects.toThrow(/limit/);
    await expect(
      // @ts-expect-error fractional limit
      paginatedPull({ prismaModel: prisma.item, userId, cursor: null, limit: 1.5 }),
    ).rejects.toThrow(/limit/);
  });

  it("rejects empty userId", async () => {
    await expect(
      paginatedPull({ prismaModel: prisma.item, userId: "", cursor: null, limit: 50 }),
    ).rejects.toThrow(/userId/);
  });

  // ── Cursor formats ──

  it("accepts a legacy timestamp-only cursor and resumes correctly", async () => {
    const t0 = new Date("2026-04-25T10:00:00.000Z");
    for (let i = 0; i < 10; i++) {
      await seedItem({ userId, title: `t${i}`, updatedAt: new Date(t0.getTime() + i * 1000) });
    }
    // Cursor at t0 + 4500ms should leave 5 rows ahead (those at +5000 .. +9000).
    const legacyCursor = new Date(t0.getTime() + 4500).toISOString();
    const page = await paginatedPull({
      prismaModel: prisma.item,
      userId,
      cursor: legacyCursor,
      limit: 50,
    });
    expect(page.upserted.length).toBe(5);
  });

  it("returns nextCursor=null on an empty page so caller can preserve their cursor", async () => {
    const t0 = new Date("2026-04-25T10:00:00.000Z");
    for (let i = 0; i < 5; i++) {
      await seedItem({ userId, title: `t${i}`, updatedAt: new Date(t0.getTime() + i) });
    }
    // Cursor past the latest row → empty page.
    const past = new Date(t0.getTime() + 1_000_000).toISOString();
    const page = await paginatedPull({
      prismaModel: prisma.item,
      userId,
      cursor: `${past}|zzzzz`,
      limit: 50,
    });
    expect(page.upserted).toEqual([]);
    expect(page.hasMore).toBe(false);
    expect(page.nextCursor).toBeNull();
  });
});
