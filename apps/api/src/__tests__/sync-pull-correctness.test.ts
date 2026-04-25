import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { createTestUser, authRequest } from "./helpers.js";
import { prisma } from "../lib/prisma.js";
import { clearAllRateLimits } from "../middleware/rate-limit.js";

/**
 * Route-level guards for /sync/pull's per-table page sizing and
 * multi-round walk semantics. The unit-level invariants live in
 * `paginated-pull.test.ts`; this file exercises the same correctness
 * properties through the actual HTTP route, so a future refactor that
 * skips the shared core can't accidentally bypass them.
 */
describe("POST /sync/pull — pagination correctness", () => {
  let token: string;
  let userId: string;
  let listId: string;

  beforeAll(async () => {
    const user = await createTestUser("Sync Pagination");
    token = user.token;
    userId = user.userId;

    const listRes = await authRequest("/lists", token, {
      method: "POST",
      body: JSON.stringify({ name: "Pagination List", colorClass: "bg-blue-500" }),
    });
    listId = ((await listRes.json()) as any).id;
  });

  beforeEach(async () => {
    clearAllRateLimits();
    // Hard-delete to bypass the soft-delete extension. Wipe items + lists
    // owned by THIS test user only; leave the seeded `listId` row alone.
    await prisma.$executeRaw`DELETE FROM "Item" WHERE "userId" = ${userId}`;
  });

  /**
   * Bulk-seed items directly via Prisma — much faster than the HTTP create
   * path and avoids tripping route-level rate limits when run inside the
   * full test suite. Uses `createMany` (extension-aware) since `Item`
   * participates in soft-delete: `deletedAt` is implicitly null on insert.
   */
  async function seedItems(opts: {
    count: number;
    titlePrefix: string;
    deleted?: boolean;
  }): Promise<string[]> {
    const ids: string[] = [];
    const rows = Array.from({ length: opts.count }, (_, i) => ({
      userId,
      type: "task",
      status: "active",
      title: `${opts.titlePrefix}${i}`,
    }));
    const created = await prisma.item.createManyAndReturn({ data: rows });
    for (const row of created) ids.push(row.id);
    if (opts.deleted) {
      // Use updateMany so we set deletedAt without going through the
      // soft-delete-converter for delete (which would also fire here).
      await prisma.item.updateMany({
        where: { id: { in: ids } },
        data: { deletedAt: new Date() },
      });
    }
    return ids;
  }

  // ── Per-table default page sizing ──

  it("uses a small default page size for `items` (50) when client omits limit", async () => {
    // Seed 60 items — above the items default (50), below the small-table
    // default (200). If the route is using the wrong default, the page
    // size will visibly come back wrong.
    await seedItems({ count: 60, titlePrefix: "bulk-" });
    clearAllRateLimits();

    const res = await authRequest("/sync/pull", token, {
      method: "POST",
      body: JSON.stringify({ protocolVersion: 1, cursors: {} }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.changes.items.upserted.length).toBe(50);
    expect(body.changes.items.hasMore).toBe(true);
  });

  it("uses a larger default page size for metadata tables (lists) when client omits limit", async () => {
    clearAllRateLimits();
    // The route default for `lists` is 200. Even creating 60 lists should
    // come back in a single page with hasMore=false.
    for (let i = 0; i < 60; i++) {
      await authRequest("/lists", token, {
        method: "POST",
        body: JSON.stringify({ name: `bulk-list-${i}`, colorClass: "bg-blue-500" }),
      });
    }
    clearAllRateLimits();

    const res = await authRequest("/sync/pull", token, {
      method: "POST",
      body: JSON.stringify({ protocolVersion: 1, cursors: {} }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    // 60 created above + the suite's seeded list = 61 rows on this user.
    expect(body.changes.lists.upserted.length).toBeGreaterThanOrEqual(60);
    expect(body.changes.lists.hasMore).toBe(false);

    // Cleanup the bulk-created lists so subsequent tests aren't polluted.
    await prisma.$executeRaw`DELETE FROM "List" WHERE "userId" = ${userId} AND "name" LIKE 'bulk-list-%'`;
  });

  it("client-supplied `limit` overrides every table's default", async () => {
    // Verify the legacy single-knob behavior still works for clients on
    // older protocols. Seed 5 items; ask for limit=2 → page caps at 2.
    await seedItems({ count: 5, titlePrefix: "limit-test-" });
    clearAllRateLimits();

    const res = await authRequest("/sync/pull", token, {
      method: "POST",
      body: JSON.stringify({ protocolVersion: 1, cursors: {}, limit: 2 }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.changes.items.upserted.length).toBe(2);
    expect(body.changes.items.hasMore).toBe(true);
  });

  // ── Multi-round walk via cursors ──

  /**
   * Walk /sync/pull until every requested table reports hasMore=false.
   * Returns the union of every page's upserted ids for `items`. Used as a
   * regression guard — total returned must equal total seeded.
   */
  async function walkSyncPull(
    sessionToken: string,
    initialCursors: Record<string, string> = {},
  ): Promise<{ itemIds: string[]; rounds: number }> {
    let cursors: Record<string, string> = { ...initialCursors };
    const itemIds: string[] = [];
    const SAFETY_CAP = 200;
    for (let round = 0; round < SAFETY_CAP; round++) {
      clearAllRateLimits();
      const res = await authRequest("/sync/pull", sessionToken, {
        method: "POST",
        body: JSON.stringify({ protocolVersion: 1, cursors }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      for (const row of body.changes.items.upserted) {
        itemIds.push(row.id);
      }
      const anyMore = Object.values(body.changes).some((c: any) => c.hasMore);
      cursors = body.cursors;
      if (!anyMore) return { itemIds, rounds: round + 1 };
    }
    throw new Error("walkSyncPull exceeded SAFETY_CAP");
  }

  it("walks 200 items across multiple pages without dropping any", async () => {
    const seeded = new Set(await seedItems({ count: 200, titlePrefix: "walk-" }));

    const { itemIds, rounds } = await walkSyncPull(token);
    expect(new Set(itemIds)).toEqual(seeded);
    expect(rounds).toBeGreaterThanOrEqual(4); // 200 / 50 per round = 4 rounds minimum
  });

  it("two consecutive full walks return identical id sets — the determinism guard", async () => {
    await seedItems({ count: 120, titlePrefix: "det-" });

    const walk1 = await walkSyncPull(token);
    const walk2 = await walkSyncPull(token);
    expect(new Set(walk1.itemIds)).toEqual(new Set(walk2.itemIds));
  });

  // ── Tombstone race regression guard ──

  it("interleaved tombstones with later updatedAt than upsert tail are not skipped", async () => {
    // Seed live rows first.
    const liveIds = new Set(await seedItems({ count: 60, titlePrefix: "live-" }));

    // Then create + delete 5 items so their tombstones sit at later
    // `updatedAt` than every live row's last update. Pre-fix this exact
    // shape was where the upsert-vs-tombstone winner race silently
    // dropped rows. Direct prisma writes ensure the tombstones'
    // updatedAt is strictly later than the live tail's.
    const deadIds = new Set(await seedItems({ count: 5, titlePrefix: "dead-", deleted: true }));

    const cursors: Record<string, string> = {};
    let allUpserted: string[] = [];
    let allDeleted: string[] = [];
    let safety = 0;
    while (true) {
      clearAllRateLimits();
      const res = await authRequest("/sync/pull", token, {
        method: "POST",
        body: JSON.stringify({ protocolVersion: 1, cursors }),
      });
      const body = (await res.json()) as any;
      allUpserted = allUpserted.concat(body.changes.items.upserted.map((r: any) => r.id));
      allDeleted = allDeleted.concat(body.changes.items.deleted);
      Object.assign(cursors, body.cursors);
      const anyMore = Object.values(body.changes).some((c: any) => c.hasMore);
      if (!anyMore) break;
      if (++safety > 50) throw new Error("walk did not converge");
    }

    // Every live row must surface in `upserted` and every deleted row in
    // `deleted`. No row may be silently lost across the boundary.
    expect(new Set(allUpserted)).toEqual(liveIds);
    expect(new Set(allDeleted)).toEqual(deadIds);
  });
});
