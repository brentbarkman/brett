import { describe, it, expect } from "vitest";
import { fuseResults } from "../embedding/search.js";
import type { RankedResult } from "../embedding/search.js";

function makeResult(
  entityType: string,
  entityId: string,
  title: string,
  rank: number
): RankedResult {
  return {
    entityType,
    entityId,
    title,
    snippet: `snippet for ${title}`,
    rank,
  };
}

describe("fuseResults", () => {
  describe("basic RRF fusion", () => {
    it("merges two lists and ranks shared results higher", () => {
      const keyword: RankedResult[] = [
        makeResult("item", "a1", "Budget Review", 1),
        makeResult("item", "a2", "Q3 Financials", 2),
        makeResult("item", "a3", "Revenue Forecast", 3),
      ];
      const vector: RankedResult[] = [
        makeResult("item", "a2", "Q3 Financials", 1), // shared
        makeResult("item", "a4", "Investor Deck", 2),
        makeResult("item", "a1", "Budget Review", 3), // shared
      ];

      const results = fuseResults(keyword, vector, 10);

      // Shared results (a1, a2) should score higher than keyword-only (a3) or vector-only (a4)
      const ids = results.map((r) => r.entityId);
      const a2Idx = ids.indexOf("a2");
      const a1Idx = ids.indexOf("a1");
      const a3Idx = ids.indexOf("a3");
      const a4Idx = ids.indexOf("a4");

      expect(a2Idx).toBeLessThan(a3Idx);
      expect(a2Idx).toBeLessThan(a4Idx);
      expect(a1Idx).toBeLessThan(a3Idx);
      expect(a1Idx).toBeLessThan(a4Idx);
    });

    it("deduplicates by entityType:entityId", () => {
      const keyword: RankedResult[] = [makeResult("item", "x1", "Duplicate", 1)];
      const vector: RankedResult[] = [makeResult("item", "x1", "Duplicate", 1)];

      const results = fuseResults(keyword, vector, 10);

      const x1Results = results.filter((r) => r.entityId === "x1");
      expect(x1Results).toHaveLength(1);
    });

    it("respects the limit parameter", () => {
      const keyword: RankedResult[] = [
        makeResult("item", "a", "A", 1),
        makeResult("item", "b", "B", 2),
        makeResult("item", "c", "C", 3),
        makeResult("item", "d", "D", 4),
        makeResult("item", "e", "E", 5),
      ];
      const vector: RankedResult[] = [
        makeResult("item", "f", "F", 1),
        makeResult("item", "g", "G", 2),
      ];

      const results = fuseResults(keyword, vector, 3);
      expect(results).toHaveLength(3);
    });

    it("sorts by RRF score descending", () => {
      const keyword: RankedResult[] = [
        makeResult("item", "a", "A", 1),
        makeResult("item", "b", "B", 2),
        makeResult("item", "c", "C", 3),
      ];
      const vector: RankedResult[] = [
        makeResult("item", "a", "A", 1), // highest combined score
        makeResult("item", "b", "B", 3),
        makeResult("item", "d", "D", 2),
      ];

      const results = fuseResults(keyword, vector, 10);

      // Verify scores are non-increasing
      for (let i = 1; i < results.length; i++) {
        expect(results[i].score).toBeLessThanOrEqual(results[i - 1].score);
      }
    });
  });

  describe("matchType assignment", () => {
    it('assigns "both" when result appears in both lists', () => {
      const keyword: RankedResult[] = [makeResult("item", "shared", "Shared", 1)];
      const vector: RankedResult[] = [makeResult("item", "shared", "Shared", 1)];

      const results = fuseResults(keyword, vector, 10);
      const sharedResult = results.find((r) => r.entityId === "shared");

      expect(sharedResult?.matchType).toBe("both");
    });

    it('assigns "keyword" when result appears only in keyword list', () => {
      const keyword: RankedResult[] = [makeResult("item", "kw-only", "Keyword Only", 1)];
      const vector: RankedResult[] = [makeResult("item", "vec-only", "Vector Only", 1)];

      const results = fuseResults(keyword, vector, 10);
      const kwResult = results.find((r) => r.entityId === "kw-only");

      expect(kwResult?.matchType).toBe("keyword");
    });

    it('assigns "semantic" when result appears only in vector list', () => {
      const keyword: RankedResult[] = [makeResult("item", "kw-only", "Keyword Only", 1)];
      const vector: RankedResult[] = [makeResult("item", "vec-only", "Vector Only", 1)];

      const results = fuseResults(keyword, vector, 10);
      const vecResult = results.find((r) => r.entityId === "vec-only");

      expect(vecResult?.matchType).toBe("semantic");
    });
  });

  describe("empty list handling", () => {
    it("handles empty keyword list — returns vector results as semantic", () => {
      const keyword: RankedResult[] = [];
      const vector: RankedResult[] = [
        makeResult("item", "v1", "Vector One", 1),
        makeResult("item", "v2", "Vector Two", 2),
      ];

      const results = fuseResults(keyword, vector, 10);

      expect(results).toHaveLength(2);
      expect(results.every((r) => r.matchType === "semantic")).toBe(true);
    });

    it("handles empty vector list — returns keyword results as keyword", () => {
      const keyword: RankedResult[] = [
        makeResult("item", "k1", "Keyword One", 1),
        makeResult("item", "k2", "Keyword Two", 2),
      ];
      const vector: RankedResult[] = [];

      const results = fuseResults(keyword, vector, 10);

      expect(results).toHaveLength(2);
      expect(results.every((r) => r.matchType === "keyword")).toBe(true);
    });

    it("returns empty array when both lists are empty", () => {
      const results = fuseResults([], [], 10);
      expect(results).toHaveLength(0);
    });
  });

  describe("cross-type deduplication", () => {
    it("treats same entityId with different entityType as distinct results", () => {
      const keyword: RankedResult[] = [
        makeResult("item", "shared-id", "Item", 1),
        makeResult("calendar_event", "shared-id", "Event", 2),
      ];
      const vector: RankedResult[] = [];

      const results = fuseResults(keyword, vector, 10);
      expect(results).toHaveLength(2);
    });
  });
});
