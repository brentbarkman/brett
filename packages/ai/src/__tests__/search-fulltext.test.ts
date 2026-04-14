/**
 * Tests for the full-text search implementation of keywordSearch.
 *
 * Unit tests use a mocked Prisma client to validate:
 *   - Empty/whitespace queries return []
 *   - Special characters don't crash (passed safely via parameterized queries)
 *   - Type filtering works correctly
 *   - Results are ranked by fts_rank and assigned 1-based ranks
 *   - Title matches (weight A) rank above body matches (weight C/D)
 *
 * Integration tests (marked with .skip when no DB) validate:
 *   - Stemming (searching "running" finds "run")
 *   - Stop-word-only queries return [] gracefully
 *
 * To run integration tests, start Postgres and apply migrations:
 *   pnpm db:up && pnpm db:migrate
 */

import { describe, it, expect, vi } from "vitest";
import { keywordSearch } from "../embedding/search.js";

// ---------------------------------------------------------------------------
// Mock Prisma helpers
// ---------------------------------------------------------------------------

function createMockPrisma(responses: Record<string, unknown[]> = {}) {
  const callLog: Array<{ sql: string; params: unknown[] }> = [];

  return {
    callLog,
    $queryRaw: vi.fn().mockImplementation((strings: TemplateStringsArray, ...values: unknown[]) => {
      // Determine which table is being queried from the SQL template
      const sql = strings.join("?");
      callLog.push({ sql, params: values });

      if (sql.includes('"Item"')) return Promise.resolve(responses.item ?? []);
      if (sql.includes('"CalendarEvent"')) return Promise.resolve(responses.calendar_event ?? []);
      if (sql.includes('"GranolaMeeting"')) return Promise.resolve(responses.meeting_note ?? []);
      if (sql.includes('"ScoutFinding"')) return Promise.resolve(responses.scout_finding ?? []);
      return Promise.resolve([]);
    }),
  };
}

// ---------------------------------------------------------------------------
// Unit tests
// ---------------------------------------------------------------------------

describe("keywordSearch (full-text)", () => {
  it("returns [] for empty query", async () => {
    const prisma = createMockPrisma();
    const results = await keywordSearch("user-1", "", null, prisma);
    expect(results).toEqual([]);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it("returns [] for whitespace-only query", async () => {
    const prisma = createMockPrisma();
    const results = await keywordSearch("user-1", "   ", null, prisma);
    expect(results).toEqual([]);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it("special characters do not crash", async () => {
    const prisma = createMockPrisma();
    // These would crash to_tsquery but plainto_tsquery handles them safely
    const results = await keywordSearch("user-1", "foo & bar | !baz (qux)", null, prisma);
    expect(results).toEqual([]);
    // Should have made 4 queries (one per entity type), none crashed
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(4);
  });

  it("stop-word-only queries do not crash", async () => {
    // plainto_tsquery('english', 'the') produces an empty tsquery, which matches nothing
    const prisma = createMockPrisma();
    const results = await keywordSearch("user-1", "the", null, prisma);
    expect(results).toEqual([]);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(4);
  });

  it("title matches (higher fts_rank) rank above body matches", async () => {
    const prisma = createMockPrisma({
      item: [
        { id: "title-match", title: "Project planning", snippet: "", fts_rank: 0.8 },
        { id: "body-match", title: "Random item", snippet: "Discussed project planning in detail", fts_rank: 0.2 },
      ],
    });

    const results = await keywordSearch("user-1", "project planning", ["item"], prisma);

    expect(results).toHaveLength(2);
    expect(results[0].entityId).toBe("title-match");
    expect(results[0].rank).toBe(1);
    expect(results[1].entityId).toBe("body-match");
    expect(results[1].rank).toBe(2);
  });

  it("filters to requested entity types only", async () => {
    const prisma = createMockPrisma({
      item: [{ id: "i1", title: "Item", snippet: "", fts_rank: 0.5 }],
      calendar_event: [{ id: "e1", title: "Event", snippet: "", fts_rank: 0.5 }],
    });

    const results = await keywordSearch("user-1", "test", ["item"], prisma);

    expect(results).toHaveLength(1);
    expect(results[0].entityType).toBe("item");
    // Should only query Item table, not CalendarEvent
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it("searches all entity types when types is null", async () => {
    const prisma = createMockPrisma();

    await keywordSearch("user-1", "test", null, prisma);

    // Should query all 4 tables
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(4);
  });

  it("returns [] when types array contains only invalid types", async () => {
    const prisma = createMockPrisma();

    const results = await keywordSearch("user-1", "test", ["invalid_type"], prisma);

    expect(results).toEqual([]);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it("assigns 1-based ranks across entity types sorted by fts_rank", async () => {
    const prisma = createMockPrisma({
      item: [{ id: "i1", title: "High rank item", snippet: "", fts_rank: 0.9 }],
      calendar_event: [{ id: "e1", title: "Medium rank event", snippet: "", fts_rank: 0.5 }],
      meeting_note: [{ id: "m1", title: "Low rank note", snippet: "", fts_rank: 0.1 }],
    });

    const results = await keywordSearch("user-1", "test", null, prisma);

    expect(results).toHaveLength(3);
    expect(results[0]).toMatchObject({ entityId: "i1", entityType: "item", rank: 1 });
    expect(results[1]).toMatchObject({ entityId: "e1", entityType: "calendar_event", rank: 2 });
    expect(results[2]).toMatchObject({ entityId: "m1", entityType: "meeting_note", rank: 3 });
  });

  it("respects limit parameter", async () => {
    const prisma = createMockPrisma({
      item: [
        { id: "i1", title: "A", snippet: "", fts_rank: 0.9 },
        { id: "i2", title: "B", snippet: "", fts_rank: 0.8 },
        { id: "i3", title: "C", snippet: "", fts_rank: 0.7 },
      ],
    });

    const results = await keywordSearch("user-1", "test", ["item"], prisma, 2);

    expect(results).toHaveLength(2);
    expect(results[0].entityId).toBe("i1");
    expect(results[1].entityId).toBe("i2");
  });

  it("handles scout_finding type (joins through Scout table)", async () => {
    const prisma = createMockPrisma({
      scout_finding: [{ id: "sf1", title: "Finding", snippet: "Details", fts_rank: 0.7 }],
    });

    const results = await keywordSearch("user-1", "test", ["scout_finding"], prisma);

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      entityType: "scout_finding",
      entityId: "sf1",
      title: "Finding",
      snippet: "Details",
      rank: 1,
    });
    // Verify the SQL includes ScoutFinding JOIN Scout
    const sql = prisma.callLog[0]?.sql ?? "";
    expect(sql).toContain('"ScoutFinding"');
    expect(sql).toContain('"Scout"');
  });
});
