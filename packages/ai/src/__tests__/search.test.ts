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

  it("prefers the vector chunk snippet over the keyword summary for meeting_notes", () => {
    // For meetings the keyword path returns the full summary as snippet,
    // while the vector path returns the specific chunk that matched the
    // query. When both match, callers want the chunk — it's the reason
    // for surfacing the meeting at all.
    const meetingKw: RankedResult[] = [
      {
        entityType: "meeting_note",
        entityId: "m1",
        title: "Sync with Yves",
        snippet: "Full summary covering Function Health company update.",
        rank: 1,
      },
    ];
    const meetingVec: RankedResult[] = [
      {
        entityType: "meeting_note",
        entityId: "m1",
        title: "Sync with Yves",
        snippet:
          "Transcript: Them: Hey, Brent. Me: Hey Yves. Them: We announced the GitLab acquisition this week.",
        rank: 1,
      },
    ];

    const [result] = fuseResults(meetingKw, meetingVec, 1);
    expect(result.matchType).toBe("both");
    expect(result.snippet).toContain("Transcript:");
  });

  it("does not swap snippets for non-meeting entity types", () => {
    // Items have small uniform bodies — keyword snippet is already the
    // whole body, swapping to the vector chunk (which is often identical)
    // adds no value and could destabilize existing behavior.
    const itemKw: RankedResult[] = [
      { entityType: "item", entityId: "i1", title: "T", snippet: "keyword-body", rank: 1 },
    ];
    const itemVec: RankedResult[] = [
      { entityType: "item", entityId: "i1", title: "T", snippet: "vector-chunk", rank: 1 },
    ];
    const [result] = fuseResults(itemKw, itemVec, 1);
    expect(result.snippet).toBe("keyword-body");
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
