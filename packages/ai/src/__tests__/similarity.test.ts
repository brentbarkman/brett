import { describe, it, expect } from "vitest";
import { classifyMatches, type SimilarityMatch } from "../embedding/similarity.js";

describe("classifyMatches", () => {
  it("classifies auto-link matches above 0.90", () => {
    const matches: SimilarityMatch[] = [
      { entityId: "a", similarity: 0.95 },
      { entityId: "b", similarity: 0.80 },
      { entityId: "c", similarity: 0.60 },
    ];
    const result = classifyMatches(matches);
    expect(result.autoLinks.map((m) => m.entityId)).toEqual(["a"]);
    expect(result.suggestions.map((m) => m.entityId)).toEqual(["b"]);
  });

  it("classifies suggestions between 0.75 and 0.90", () => {
    const matches: SimilarityMatch[] = [{ entityId: "a", similarity: 0.82 }];
    const result = classifyMatches(matches);
    expect(result.autoLinks).toHaveLength(0);
    expect(result.suggestions).toHaveLength(1);
  });

  it("discards below 0.75", () => {
    const matches: SimilarityMatch[] = [{ entityId: "a", similarity: 0.50 }];
    const result = classifyMatches(matches);
    expect(result.autoLinks).toHaveLength(0);
    expect(result.suggestions).toHaveLength(0);
  });

  it("handles empty input", () => {
    const result = classifyMatches([]);
    expect(result.autoLinks).toHaveLength(0);
    expect(result.suggestions).toHaveLength(0);
  });
});
