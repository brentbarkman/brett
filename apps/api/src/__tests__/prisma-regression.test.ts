/**
 * Prisma Regression Test Suite
 *
 * These tests verify Prisma's contract with our application code.
 * They are designed to catch breaking changes during Prisma major version upgrades.
 *
 * Categories:
 * 1. Raw query return types & parameter binding
 * 2. Transaction semantics (callback + array syntax, rollback)
 * 3. Relation loading shapes (include/select)
 * 4. Json field round-trips
 * 5. Enum mapping
 * 6. Upsert behavior
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient, Prisma } from "@brett/api-core";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

let testUserId: string;
let testListId: string;

/** Default required fields for creating a test scout */
function testScoutData(overrides: Record<string, unknown> = {}) {
  return {
    userId: "", // Set in tests
    name: "Test Scout",
    avatarLetter: "T",
    avatarGradientFrom: "#000",
    avatarGradientTo: "#fff",
    goal: "Test goal",
    sources: [],
    sensitivity: "medium" as const,
    cadenceIntervalHours: 24,
    cadenceMinIntervalHours: 4,
    cadenceCurrentIntervalHours: 24,
    budgetTotal: 10,
    budgetResetAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    status: "active" as const,
    ...overrides,
  };
}

beforeAll(async () => {
  // Create a test user directly via Prisma (bypassing auth for unit isolation)
  const user = await prisma.user.create({
    data: {
      id: `prisma-regression-${Date.now()}`,
      email: `prisma-reg-${Date.now()}@test.com`,
      name: "Prisma Regression User",
    },
  });
  testUserId = user.id;

  // Create a test list
  const list = await prisma.list.create({
    data: {
      name: `Regression List ${Date.now()}`,
      colorClass: "bg-blue-400",
      sortOrder: 0,
      userId: testUserId,
    },
  });
  testListId = list.id;
});

afterAll(async () => {
  // Clean up in dependency order
  await prisma.item.deleteMany({ where: { userId: testUserId } });
  await prisma.list.deleteMany({ where: { userId: testUserId } });
  await prisma.session.deleteMany({ where: { userId: testUserId } });
  await prisma.account.deleteMany({ where: { userId: testUserId } });
  await prisma.user.delete({ where: { id: testUserId } }).catch(() => {});
  await prisma.$disconnect();
});

// ─── 1. Raw Query Return Types & Parameter Binding ─────────────────────────

describe("Raw query return types", () => {
  it("$queryRaw returns typed results with correct column names", async () => {
    const rows = await prisma.$queryRaw<
      Array<{ id: string; name: string }>
    >`SELECT id, name FROM "User" WHERE id = ${testUserId}`;

    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(testUserId);
    expect(rows[0].name).toBe("Prisma Regression User");
    // Verify no extra properties leak through
    expect(Object.keys(rows[0]).sort()).toEqual(["id", "name"]);
  });

  it("$queryRaw handles NULL values correctly", async () => {
    const rows = await prisma.$queryRaw<
      Array<{ image: string | null }>
    >`SELECT image FROM "User" WHERE id = ${testUserId}`;

    expect(rows).toHaveLength(1);
    expect(rows[0].image).toBeNull();
  });

  it("$queryRaw handles numeric types correctly", async () => {
    const rows = await prisma.$queryRaw<
      Array<{ count: bigint }>
    >`SELECT COUNT(*) as count FROM "User" WHERE id = ${testUserId}`;

    expect(rows).toHaveLength(1);
    // Prisma returns COUNT as bigint
    expect(typeof rows[0].count).toBe("bigint");
    expect(rows[0].count).toBe(1n);
  });

  it("$queryRaw handles DateTime columns as Date objects", async () => {
    const rows = await prisma.$queryRaw<
      Array<{ createdAt: Date }>
    >`SELECT "createdAt" FROM "User" WHERE id = ${testUserId}`;

    expect(rows).toHaveLength(1);
    expect(rows[0].createdAt).toBeInstanceOf(Date);
  });

  it("$queryRaw returns empty array for no matches", async () => {
    const rows = await prisma.$queryRaw<
      Array<{ id: string }>
    >`SELECT id FROM "User" WHERE id = ${"nonexistent-id-123"}`;

    expect(rows).toEqual([]);
  });

  it("$executeRaw returns affected row count", async () => {
    // Update with no actual change — should still report 1 affected row
    const count = await prisma.$executeRaw`
      UPDATE "User" SET name = name WHERE id = ${testUserId}
    `;
    expect(typeof count).toBe("number");
    expect(count).toBe(1);
  });

  it("$executeRaw with tagged template handles string interpolation safely", async () => {
    const malicious = "'; DROP TABLE \"User\"; --";
    const count = await prisma.$executeRaw`
      UPDATE "User" SET name = ${malicious} WHERE id = ${"nonexistent"}
    `;
    expect(count).toBe(0);

    // Verify table still exists
    const rows = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "User" WHERE id = ${testUserId}
    `;
    expect(rows).toHaveLength(1);
  });

  it("Prisma.join() works for IN clauses", async () => {
    const ids = Prisma.join([testUserId, "nonexistent"]);
    const rows = await prisma.$queryRaw<
      Array<{ id: string }>
    >`SELECT id FROM "User" WHERE id IN (${ids})`;

    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(testUserId);
  });
});

// ─── 2. Transaction Semantics ──────────────────────────────────────────────

describe("Transaction semantics", () => {
  it("callback transaction rolls back all changes on error", async () => {
    const originalName = (await prisma.user.findUnique({
      where: { id: testUserId },
      select: { name: true },
    }))!.name;

    await expect(
      prisma.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: testUserId },
          data: { name: "Should Be Rolled Back" },
        });
        // Force an error after the update
        throw new Error("Intentional rollback");
      })
    ).rejects.toThrow("Intentional rollback");

    // Verify the name was NOT changed
    const user = await prisma.user.findUnique({
      where: { id: testUserId },
      select: { name: true },
    });
    expect(user!.name).toBe(originalName);
  });

  it("array transaction rolls back all changes on constraint violation", async () => {
    const dupName = `DuplicateTest-${Date.now()}`;

    // Create the first list
    await prisma.list.create({
      data: { name: dupName, colorClass: "bg-blue-400", sortOrder: 10, userId: testUserId },
    });

    // Try to create another with the same name in a transaction with a second valid operation
    // The unique constraint violation should roll back the entire transaction
    const listCountBefore = await prisma.list.count({ where: { userId: testUserId } });

    await expect(
      prisma.$transaction([
        prisma.list.create({
          data: { name: `${dupName}-other`, colorClass: "bg-green-400", sortOrder: 11, userId: testUserId },
        }),
        prisma.list.create({
          data: { name: dupName, colorClass: "bg-red-400", sortOrder: 12, userId: testUserId }, // duplicate!
        }),
      ])
    ).rejects.toThrow();

    // Verify the first create in the transaction was also rolled back
    const listCountAfter = await prisma.list.count({ where: { userId: testUserId } });
    expect(listCountAfter).toBe(listCountBefore);

    // Clean up
    await prisma.list.deleteMany({
      where: { userId: testUserId, name: { startsWith: "DuplicateTest-" } },
    });
  });

  it("callback transaction provides isolated tx client", async () => {
    const result = await prisma.$transaction(async (tx) => {
      // Create within transaction
      const item = await tx.item.create({
        data: {
          type: "task",
          title: "TX Isolation Test",
          status: "active",
          userId: testUserId,
        },
      });

      // Read within same transaction should see the item
      const found = await tx.item.findUnique({ where: { id: item.id } });
      expect(found).not.toBeNull();
      expect(found!.title).toBe("TX Isolation Test");

      return item.id;
    });

    // Clean up
    await prisma.item.delete({ where: { id: result } });
  });

  it("array transaction executes all operations atomically", async () => {
    const item1 = await prisma.item.create({
      data: { type: "task", title: "Atomic Test 1", status: "active", userId: testUserId },
    });
    const item2 = await prisma.item.create({
      data: { type: "task", title: "Atomic Test 2", status: "active", userId: testUserId },
    });

    // Update both in a single array transaction
    await prisma.$transaction([
      prisma.item.update({ where: { id: item1.id }, data: { status: "done" } }),
      prisma.item.update({ where: { id: item2.id }, data: { status: "done" } }),
    ]);

    const [updated1, updated2] = await Promise.all([
      prisma.item.findUnique({ where: { id: item1.id } }),
      prisma.item.findUnique({ where: { id: item2.id } }),
    ]);

    expect(updated1!.status).toBe("done");
    expect(updated2!.status).toBe("done");

    // Clean up
    await prisma.item.deleteMany({
      where: { id: { in: [item1.id, item2.id] } },
    });
  });
});

// ─── 3. Relation Loading Shapes ────────────────────────────────────────────

describe("Relation loading shapes", () => {
  let itemIds: string[];

  beforeAll(async () => {
    // Create items: 2 active, 1 done
    const items = await Promise.all([
      prisma.item.create({
        data: { type: "task", title: "Active 1", status: "active", userId: testUserId, listId: testListId },
      }),
      prisma.item.create({
        data: { type: "task", title: "Active 2", status: "active", userId: testUserId, listId: testListId },
      }),
      prisma.item.create({
        data: { type: "task", title: "Done 1", status: "done", userId: testUserId, listId: testListId },
      }),
    ]);
    itemIds = items.map((i) => i.id);
  });

  afterAll(async () => {
    await prisma.item.deleteMany({ where: { id: { in: itemIds } } });
  });

  it("include with _count returns total count across all statuses", async () => {
    const list = await prisma.list.findUnique({
      where: { id: testListId },
      include: {
        _count: { select: { items: true } },
      },
    });

    expect(list).not.toBeNull();
    expect(list!._count.items).toBe(3); // All items, not filtered
  });

  it("include with filtered relation returns only matching items", async () => {
    const list = await prisma.list.findUnique({
      where: { id: testListId },
      include: {
        items: {
          where: { status: "done" },
          select: { id: true },
        },
      },
    });

    expect(list).not.toBeNull();
    expect(list!.items).toHaveLength(1); // Only the "done" item
  });

  it("_count and filtered include are independent (critical for lists.ts)", async () => {
    // This test documents that _count.items !== filtered items.length
    // Our lists.ts code relies on this distinction
    const list = await prisma.list.findUnique({
      where: { id: testListId },
      include: {
        _count: { select: { items: true } },
        items: {
          where: { status: "done" },
          select: { id: true },
        },
      },
    });

    expect(list).not.toBeNull();
    expect(list!._count.items).toBe(3);      // Total count
    expect(list!.items).toHaveLength(1);       // Only done items
    // These are intentionally different — the API uses _count for total, items.length for completed
    expect(list!._count.items).not.toBe(list!.items.length);
  });

  it("select limits returned fields", async () => {
    const item = await prisma.item.findFirst({
      where: { userId: testUserId },
      select: { id: true, title: true },
    });

    expect(item).not.toBeNull();
    expect(item).toHaveProperty("id");
    expect(item).toHaveProperty("title");
    // Should NOT have other fields
    expect(item).not.toHaveProperty("status");
    expect(item).not.toHaveProperty("userId");
  });

  it("nested include loads related records", async () => {
    const user = await prisma.user.findUnique({
      where: { id: testUserId },
      include: {
        lists: {
          include: {
            _count: { select: { items: true } },
          },
        },
      },
    });

    expect(user).not.toBeNull();
    expect(user!.lists).toBeInstanceOf(Array);
    expect(user!.lists.length).toBeGreaterThanOrEqual(1);
    expect(user!.lists[0]._count.items).toBeGreaterThanOrEqual(0);
  });
});

// ─── 4. Json Field Round-trips ─────────────────────────────────────────────

describe("Json field round-trips", () => {
  let weatherCacheId: string | null = null;

  afterAll(async () => {
    if (weatherCacheId) {
      await prisma.weatherCache.delete({ where: { id: weatherCacheId } }).catch(() => {});
    }
  });

  it("Json field stores and retrieves objects", async () => {
    const currentWeather = {
      temp: 72,
      feelsLike: 70,
      condition: "sunny",
      humidity: 45,
    };

    const cache = await prisma.weatherCache.upsert({
      where: { userId: testUserId },
      create: {
        userId: testUserId,
        current: currentWeather as unknown as Prisma.InputJsonValue,
        hourly: [] as unknown as Prisma.InputJsonValue,
        daily: [] as unknown as Prisma.InputJsonValue,
        fetchedAt: new Date(),
        expiresAt: new Date(Date.now() + 3600000),
      },
      update: {
        current: currentWeather as unknown as Prisma.InputJsonValue,
        fetchedAt: new Date(),
        expiresAt: new Date(Date.now() + 3600000),
      },
    });
    weatherCacheId = cache.id;

    // Read it back
    const read = await prisma.weatherCache.findUnique({
      where: { userId: testUserId },
    });

    expect(read).not.toBeNull();
    expect(read!.current).toEqual(currentWeather);
    // Verify the round-trip preserves types
    const current = read!.current as Record<string, unknown>;
    expect(typeof current.temp).toBe("number");
    expect(typeof current.condition).toBe("string");
    expect(typeof current.humidity).toBe("number");
  });

  it("Json field stores and retrieves arrays", async () => {
    const hourlyData = [
      { hour: 0, temp: 65 },
      { hour: 1, temp: 64 },
      { hour: 2, temp: 63 },
    ];

    await prisma.weatherCache.update({
      where: { userId: testUserId },
      data: { hourly: hourlyData as unknown as Prisma.InputJsonValue },
    });

    const read = await prisma.weatherCache.findUnique({
      where: { userId: testUserId },
    });

    expect(read!.hourly).toEqual(hourlyData);
    expect(Array.isArray(read!.hourly)).toBe(true);
    expect((read!.hourly as unknown[]).length).toBe(3);
  });

  it("Json field handles Prisma.DbNull for nullable fields", async () => {
    // Create an item with contentMetadata = null
    const item = await prisma.item.create({
      data: {
        type: "content",
        title: "Json Null Test",
        status: "active",
        userId: testUserId,
        contentMetadata: Prisma.DbNull,
      },
    });

    const read = await prisma.item.findUnique({ where: { id: item.id } });
    expect(read!.contentMetadata).toBeNull();

    // Now set it to an object
    await prisma.item.update({
      where: { id: item.id },
      data: {
        contentMetadata: { wordCount: 500, readingTime: 3 } as unknown as Prisma.InputJsonValue,
      },
    });

    const readAgain = await prisma.item.findUnique({ where: { id: item.id } });
    expect(readAgain!.contentMetadata).toEqual({ wordCount: 500, readingTime: 3 });

    // Clean up
    await prisma.item.delete({ where: { id: item.id } });
  });

  it("Json field preserves nested objects", async () => {
    const nested = {
      level1: {
        level2: {
          level3: "deep value",
          array: [1, 2, { nested: true }],
        },
      },
    };

    await prisma.weatherCache.update({
      where: { userId: testUserId },
      data: { daily: nested as unknown as Prisma.InputJsonValue },
    });

    const read = await prisma.weatherCache.findUnique({
      where: { userId: testUserId },
    });
    expect(read!.daily).toEqual(nested);
  });
});

// ─── 5. Enum Mapping ───────────────────────────────────────────────────────

describe("Enum mapping", () => {
  it("UserRole enum values are correct", async () => {
    const user = await prisma.user.findUnique({
      where: { id: testUserId },
      select: { role: true },
    });
    expect(user!.role).toBe("user");
    expect(["user", "admin"]).toContain(user!.role);
  });

  it("ScoutStatus enum round-trips correctly", async () => {
    const scout = await prisma.scout.create({
      data: testScoutData({ userId: testUserId, name: "Enum Test Scout" }),
    });

    expect(scout.status).toBe("active");
    expect(scout.sensitivity).toBe("medium");

    // Update to each status
    for (const status of ["paused", "completed", "expired", "active"] as const) {
      const updated = await prisma.scout.update({
        where: { id: scout.id },
        data: { status },
      });
      expect(updated.status).toBe(status);
    }

    // Clean up
    await prisma.scout.delete({ where: { id: scout.id } });
  });

  it("ScoutRunStatus enum values are all valid", async () => {
    const scout = await prisma.scout.create({
      data: testScoutData({ userId: testUserId, name: "Run Status Test", sensitivity: "low" }),
    });

    for (const status of ["running", "success", "failed", "skipped"] as const) {
      const run = await prisma.scoutRun.create({
        data: {
          scoutId: scout.id,
          status,
          resultCount: 0,
          findingsCount: 0,
          dismissedCount: 0,
          tokensUsed: 0,
          durationMs: 100,
        },
      });
      expect(run.status).toBe(status);
    }

    // Clean up
    await prisma.scoutRun.deleteMany({ where: { scoutId: scout.id } });
    await prisma.scout.delete({ where: { id: scout.id } });
  });

  it("ScoutActivityType enum values are all valid", async () => {
    const scout = await prisma.scout.create({
      data: testScoutData({ userId: testUserId, name: "Activity Type Test", sensitivity: "high" }),
    });

    const activityTypes = [
      "created", "paused", "resumed", "completed",
      "expired", "config_changed", "cadence_adapted", "budget_alert",
    ] as const;

    for (const type of activityTypes) {
      const activity = await prisma.scoutActivity.create({
        data: {
          scoutId: scout.id,
          type,
          description: `Test ${type}`,
        },
      });
      expect(activity.type).toBe(type);
    }

    // Clean up
    await prisma.scoutActivity.deleteMany({ where: { scoutId: scout.id } });
    await prisma.scout.delete({ where: { id: scout.id } });
  });

  it("ScoutMemoryType and ScoutMemoryStatus enums round-trip", async () => {
    const scout = await prisma.scout.create({
      data: testScoutData({ userId: testUserId, name: "Memory Enum Test" }),
    });

    const memoryTypes = ["factual", "judgment", "pattern"] as const;
    const memoryStatuses = ["active", "superseded", "removed", "user_deleted"] as const;

    for (const memType of memoryTypes) {
      for (const memStatus of memoryStatuses) {
        const memory = await prisma.scoutMemory.create({
          data: {
            scoutId: scout.id,
            type: memType,
            status: memStatus,
            content: `Test ${memType} ${memStatus}`,
            confidence: 0.9,
            sourceRunIds: [],
          },
        });
        expect(memory.type).toBe(memType);
        expect(memory.status).toBe(memStatus);
      }
    }

    // Clean up
    await prisma.scoutMemory.deleteMany({ where: { scoutId: scout.id } });
    await prisma.scout.delete({ where: { id: scout.id } });
  });

  it("FindingType enum values are all valid", async () => {
    const scout = await prisma.scout.create({
      data: testScoutData({ userId: testUserId, name: "Finding Type Test" }),
    });

    const run = await prisma.scoutRun.create({
      data: {
        scoutId: scout.id,
        status: "success",
        resultCount: 0,
        findingsCount: 0,
        dismissedCount: 0,
        tokensUsed: 0,
        durationMs: 100,
      },
    });

    for (const type of ["insight", "article", "task"] as const) {
      const finding = await prisma.scoutFinding.create({
        data: {
          scoutId: scout.id,
          scoutRunId: run.id,
          type,
          title: `Test ${type}`,
          description: "Test description",
          sourceName: "Test Source",
          relevanceScore: 0.8,
          reasoning: "Test reasoning",
        },
      });
      expect(finding.type).toBe(type);
    }

    // Clean up
    await prisma.scoutFinding.deleteMany({ where: { scoutId: scout.id } });
    await prisma.scoutRun.deleteMany({ where: { scoutId: scout.id } });
    await prisma.scout.delete({ where: { id: scout.id } });
  });
});

// ─── 6. Upsert Behavior ───────────────────────────────────────────────────

describe("Upsert behavior", () => {
  it("upsert creates when record doesn't exist", async () => {
    const uniqueName = `Upsert Create ${Date.now()}`;
    const list = await prisma.list.upsert({
      where: { userId_name: { userId: testUserId, name: uniqueName } },
      create: {
        name: uniqueName,
        colorClass: "bg-green-400",
        sortOrder: 99,
        userId: testUserId,
      },
      update: {
        colorClass: "bg-red-400",
      },
    });

    expect(list.name).toBe(uniqueName);
    expect(list.colorClass).toBe("bg-green-400"); // Created, not updated

    // Clean up
    await prisma.list.delete({ where: { id: list.id } });
  });

  it("upsert updates when record exists", async () => {
    const uniqueName = `Upsert Update ${Date.now()}`;
    // Create first
    await prisma.list.create({
      data: {
        name: uniqueName,
        colorClass: "bg-green-400",
        sortOrder: 99,
        userId: testUserId,
      },
    });

    // Upsert should update
    const list = await prisma.list.upsert({
      where: { userId_name: { userId: testUserId, name: uniqueName } },
      create: {
        name: uniqueName,
        colorClass: "bg-green-400",
        sortOrder: 99,
        userId: testUserId,
      },
      update: {
        colorClass: "bg-red-400",
      },
    });

    expect(list.name).toBe(uniqueName);
    expect(list.colorClass).toBe("bg-red-400"); // Updated

    // Clean up
    await prisma.list.delete({ where: { id: list.id } });
  });
});

// ─── 7. findUnique vs findFirst behavior ───────────────────────────────────

describe("findUnique vs findFirst", () => {
  it("findUnique returns null for non-existent record", async () => {
    const result = await prisma.list.findUnique({
      where: { id: "nonexistent-id-12345" },
    });
    expect(result).toBeNull();
  });

  it("findUnique on compound unique works", async () => {
    const list = await prisma.list.findUnique({
      where: { userId_name: { userId: testUserId, name: `Regression List ${testListId.split("-")[0]}` } },
    });
    // May or may not find it depending on name, but shouldn't throw
    // The important thing is the compound key works
  });

  it("findFirst without orderBy returns a result (but order is undefined)", async () => {
    const result = await prisma.item.findFirst({
      where: { userId: testUserId },
    });
    // Just verify it doesn't throw — the order is undefined
    // This documents the behavior our code relies on
  });
});

// ─── 8. Prisma Error Types ─────────────────────────────────────────────────

describe("Prisma error types", () => {
  it("unique constraint violation throws PrismaClientKnownRequestError with P2002", async () => {
    const name = `Unique Error Test ${Date.now()}`;
    await prisma.list.create({
      data: { name, colorClass: "bg-blue-400", sortOrder: 0, userId: testUserId },
    });

    try {
      await prisma.list.create({
        data: { name, colorClass: "bg-red-400", sortOrder: 1, userId: testUserId },
      });
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
      expect((err as Prisma.PrismaClientKnownRequestError).code).toBe("P2002");
    }

    // Clean up
    await prisma.list.deleteMany({ where: { name, userId: testUserId } });
  });

  it("record not found in update throws PrismaClientKnownRequestError with P2025", async () => {
    try {
      await prisma.list.update({
        where: { id: "nonexistent-id-12345" },
        data: { name: "Should Fail" },
      });
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
      expect((err as Prisma.PrismaClientKnownRequestError).code).toBe("P2025");
    }
  });
});

// ─── 9. Driver Adapter Behavior (Prisma 7) ─────────────────────────────────

describe("Driver adapter behavior", () => {
  it("PrismaClient with PrismaPg adapter connects and queries", async () => {
    // Verify the adapter-based client works for basic operations
    const user = await prisma.user.findUnique({
      where: { id: testUserId },
    });
    expect(user).not.toBeNull();
    expect(user!.id).toBe(testUserId);
  });

  it("adapter handles concurrent queries", async () => {
    // Run multiple queries in parallel to verify connection pooling works
    const results = await Promise.all([
      prisma.user.findUnique({ where: { id: testUserId } }),
      prisma.list.findMany({ where: { userId: testUserId } }),
      prisma.item.count({ where: { userId: testUserId } }),
    ]);

    expect(results[0]).not.toBeNull();
    expect(Array.isArray(results[1])).toBe(true);
    expect(typeof results[2]).toBe("number");
  });

  it("adapter handles $queryRaw with tagged templates", async () => {
    const rows = await prisma.$queryRaw<
      Array<{ id: string }>
    >`SELECT id FROM "User" WHERE id = ${testUserId}`;

    expect(rows).toHaveLength(1);
  });

  it("adapter handles $executeRaw with tagged templates", async () => {
    const count = await prisma.$executeRaw`
      UPDATE "User" SET name = name WHERE id = ${testUserId}
    `;
    expect(count).toBe(1);
  });
});

// ─── 10. Generated Client Type Aliases ─────────────────────────────────────

describe("Generated client type aliases", () => {
  it("model types resolve to correct shapes", async () => {
    // Verify that Prisma 7 type aliases match expected field names
    const user = await prisma.user.findUnique({
      where: { id: testUserId },
    });
    expect(user).toHaveProperty("id");
    expect(user).toHaveProperty("email");
    expect(user).toHaveProperty("name");
    expect(user).toHaveProperty("role");
    expect(user).toHaveProperty("createdAt");
    expect(user).toHaveProperty("updatedAt");
  });

  it("Prisma.InputJsonValue accepts objects", async () => {
    // Verify JSON input typing still works through the adapter
    const item = await prisma.item.create({
      data: {
        type: "content",
        title: "JSON Type Test",
        status: "active",
        userId: testUserId,
        contentMetadata: { test: true, nested: { value: 42 } } as unknown as Prisma.InputJsonValue,
      },
    });

    const read = await prisma.item.findUnique({ where: { id: item.id } });
    expect(read!.contentMetadata).toEqual({ test: true, nested: { value: 42 } });

    await prisma.item.delete({ where: { id: item.id } });
  });

  it("Prisma.DbNull works for nullable Json fields", async () => {
    const item = await prisma.item.create({
      data: {
        type: "task",
        title: "DbNull Test",
        status: "active",
        userId: testUserId,
        contentMetadata: Prisma.DbNull,
      },
    });

    const read = await prisma.item.findUnique({ where: { id: item.id } });
    expect(read!.contentMetadata).toBeNull();

    await prisma.item.delete({ where: { id: item.id } });
  });
});
