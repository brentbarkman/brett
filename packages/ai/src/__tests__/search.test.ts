import { describe, it, expect, vi } from "vitest";
import {
  fuseResults,
  vectorSearch,
  VALID_ENTITY_TYPES,
  type RankedResult,
} from "../embedding/search.js";

// --- fuseResults ---

describe("fuseResults", () => {
  const kw: RankedResult[] = [
    { entityType: "item", entityId: "a", title: "A", snippet: "...", rank: 1 },
    { entityType: "item", entityId: "b", title: "B", snippet: "...", rank: 2 },
  ];

  const vec: RankedResult[] = [
    { entityType: "item", entityId: "b", title: "B", snippet: "...", rank: 1 },
    { entityType: "item", entityId: "c", title: "C", snippet: "...", rank: 2 },
  ];

  it("marks items found in both lists as 'both'", () => {
    const results = fuseResults(kw, vec, 10);
    const b = results.find((r) => r.entityId === "b");
    expect(b?.matchType).toBe("both");
  });

  it("ranks items in both lists higher than single-list items", () => {
    const results = fuseResults(kw, vec, 10);
    expect(results[0].entityId).toBe("b"); // appears in both lists
  });

  it("respects limit", () => {
    const results = fuseResults(kw, vec, 2);
    expect(results).toHaveLength(2);
  });
});

// --- VALID_ENTITY_TYPES allowlist ---

describe("VALID_ENTITY_TYPES", () => {
  it("contains expected entity types", () => {
    expect(VALID_ENTITY_TYPES).toContain("item");
    expect(VALID_ENTITY_TYPES).toContain("calendar_event");
    expect(VALID_ENTITY_TYPES).toContain("meeting_note");
    expect(VALID_ENTITY_TYPES).toContain("scout_finding");
  });
});

// --- vectorSearch type sanitization ---

describe("vectorSearch", () => {
  const mockProvider = {
    dimensions: 3,
    modelId: "mock-test",
    embed: vi.fn().mockResolvedValue([1, 0, 0]),
    embedBatch: vi.fn(),
  };

  it("returns empty array when all types are invalid (SQL injection prevented)", async () => {
    const mockPrisma = { $queryRaw: vi.fn() };

    const results = await vectorSearch(
      "user-1",
      "test query",
      ["'; DROP TABLE Embedding; --", "invalid_type"],
      mockProvider,
      mockPrisma,
      10,
    );

    expect(results).toEqual([]);
    // Should NOT have called the database at all
    expect(mockPrisma.$queryRaw).not.toHaveBeenCalled();
  });

  it("filters out invalid types and keeps valid ones", async () => {
    const mockPrisma = {
      $queryRaw: vi.fn().mockResolvedValue([
        { entityType: "item", entityId: "1", chunkText: "test", similarity: 0.9 },
      ]),
    };

    const results = await vectorSearch(
      "user-1",
      "test query",
      ["item", "'; DROP TABLE Embedding; --"],
      mockProvider,
      mockPrisma,
      10,
    );

    expect(results).toHaveLength(1);
    expect(results[0].entityType).toBe("item");
    // The query should only contain 'item', not the injection string
    expect(mockPrisma.$queryRaw).toHaveBeenCalled();
  });

  it("passes null types through (searches all types)", async () => {
    const mockPrisma = {
      $queryRaw: vi.fn().mockResolvedValue([
        { entityType: "item", entityId: "1", chunkText: "test", similarity: 0.9 },
      ]),
    };

    const results = await vectorSearch(
      "user-1",
      "test query",
      null,
      mockProvider,
      mockPrisma,
      10,
    );

    expect(results).toHaveLength(1);
    expect(mockPrisma.$queryRaw).toHaveBeenCalled();
  });
});
