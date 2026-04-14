import { describe, it, expect, vi } from "vitest";
import { fuseResults, hybridSearch } from "../embedding/search.js";
import type { RerankProvider, RerankResult, EmbeddingProvider } from "../providers/types.js";
import { VoyageRerankProvider } from "../providers/voyage-rerank.js";

// Helper to create a mock rerank provider
function createMockRerankProvider(
  impl?: (query: string, documents: string[], topK?: number) => Promise<RerankResult[]>,
): RerankProvider {
  return {
    rerank: impl ?? vi.fn().mockResolvedValue([]),
  };
}

describe("hybridSearch with reranking", () => {
  const mockEmbeddingProvider: EmbeddingProvider = {
    dimensions: 3,
    embed: vi.fn().mockResolvedValue([1, 0, 0]),
    embedBatch: vi.fn().mockResolvedValue([[1, 0, 0]]),
  };

  // Mock prisma that returns FTS rows and vector rows
  function createMockPrisma(kwRows: any[], vecRows: any[]) {
    let callCount = 0;
    return {
      $queryRaw: vi.fn().mockImplementation(() => {
        callCount++;
        // First calls are keyword search (one per entity type), last call is vector search
        // Since we search all types (null), keyword will call for each type, then vector once
        // For simplicity, we check if result looks like vector or keyword
        if (callCount <= 4) {
          // Return keyword rows only on first call (item type)
          return callCount === 1 ? kwRows : [];
        }
        return vecRows;
      }),
    };
  }

  it("reorders results when rerank provider is available", async () => {
    // Create fused results via fuseResults first to understand the baseline
    const kw = [
      { entityType: "item", entityId: "a", title: "First", snippet: "first doc", rank: 1 },
      { entityType: "item", entityId: "b", title: "Second", snippet: "second doc", rank: 2 },
      { entityType: "item", entityId: "c", title: "Third", snippet: "third doc", rank: 3 },
      { entityType: "item", entityId: "d", title: "Fourth", snippet: "fourth doc", rank: 4 },
      { entityType: "item", entityId: "e", title: "Fifth", snippet: "fifth doc", rank: 5 },
    ];
    const vec = [
      { entityType: "item", entityId: "e", title: "Fifth", snippet: "fifth doc", rank: 1 },
      { entityType: "item", entityId: "d", title: "Fourth", snippet: "fourth doc", rank: 2 },
      { entityType: "item", entityId: "c", title: "Third", snippet: "third doc", rank: 3 },
    ];

    // Before reranking, RRF puts items in both lists higher
    const fused = fuseResults(kw, vec, 10);
    expect(fused.length).toBeGreaterThanOrEqual(5);

    // Reranking should reorder — put "e" first with highest score
    const rerankProvider = createMockRerankProvider(async (_query, _docs, _topK) => [
      { index: 4, relevanceScore: 0.99 }, // "e" — was likely not first in RRF
      { index: 0, relevanceScore: 0.80 }, // "a"
      { index: 1, relevanceScore: 0.70 }, // "b"
    ]);

    // Use keyword-only path (provider=null) for simplicity
    const mockPrisma = {
      $queryRaw: vi.fn().mockImplementation(() => {
        return [
          { id: "a", title: "First", snippet: "first doc", fts_rank: 5.0 },
          { id: "b", title: "Second", snippet: "second doc", fts_rank: 4.0 },
          { id: "c", title: "Third", snippet: "third doc", fts_rank: 3.0 },
          { id: "d", title: "Fourth", snippet: "fourth doc", fts_rank: 2.0 },
          { id: "e", title: "Fifth", snippet: "fifth doc", fts_rank: 1.0 },
        ];
      }),
    };

    const results = await hybridSearch("user-1", "test", ["item"], null, mockPrisma, 5, rerankProvider);

    // Reranker returns 3 results, all should be reordered by relevance score
    expect(results[0].entityId).toBe("e");
    expect(results[0].score).toBe(0.99);
    expect(results[1].entityId).toBe("a");
    expect(results[2].entityId).toBe("b");
  });

  it("falls back gracefully when rerank provider throws", async () => {
    const rerankProvider = createMockRerankProvider(async () => {
      throw new Error("API rate limit exceeded");
    });

    const mockPrisma = {
      $queryRaw: vi.fn().mockImplementation(() => {
        return [
          { id: "a", title: "First", snippet: "first doc", fts_rank: 5.0 },
          { id: "b", title: "Second", snippet: "second doc", fts_rank: 4.0 },
          { id: "c", title: "Third", snippet: "third doc", fts_rank: 3.0 },
          { id: "d", title: "Fourth", snippet: "fourth doc", fts_rank: 2.0 },
          { id: "e", title: "Fifth", snippet: "fifth doc", fts_rank: 1.0 },
        ];
      }),
    };

    // Should not throw — falls back to original order
    const results = await hybridSearch("user-1", "test", ["item"], null, mockPrisma, 5, rerankProvider);
    expect(results.length).toBeGreaterThan(0);
    // Original order preserved (by fts_rank descending)
    expect(results[0].entityId).toBe("a");
  });

  it("skips reranking when fewer than minCandidates results", async () => {
    const rerankFn = vi.fn();
    const rerankProvider = createMockRerankProvider(rerankFn);

    const mockPrisma = {
      $queryRaw: vi.fn().mockImplementation(() => {
        return [
          { id: "a", title: "First", snippet: "first doc", fts_rank: 5.0 },
          { id: "b", title: "Second", snippet: "second doc", fts_rank: 4.0 },
        ];
      }),
    };

    // Only 2 results — below minCandidates (5), so rerank should NOT be called
    const results = await hybridSearch("user-1", "test", ["item"], null, mockPrisma, 5, rerankProvider);
    expect(results.length).toBe(2);
    expect(rerankFn).not.toHaveBeenCalled();
  });

  it("skips reranking when provider is null", async () => {
    const mockPrisma = {
      $queryRaw: vi.fn().mockImplementation(() => {
        return [
          { id: "a", title: "First", snippet: "first doc", fts_rank: 5.0 },
          { id: "b", title: "Second", snippet: "second doc", fts_rank: 4.0 },
          { id: "c", title: "Third", snippet: "third doc", fts_rank: 3.0 },
          { id: "d", title: "Fourth", snippet: "fourth doc", fts_rank: 2.0 },
          { id: "e", title: "Fifth", snippet: "fifth doc", fts_rank: 1.0 },
        ];
      }),
    };

    const results = await hybridSearch("user-1", "test", ["item"], null, mockPrisma, 5, null);
    expect(results.length).toBe(5);
    // Original keyword order preserved
    expect(results[0].entityId).toBe("a");
  });

  it("skips reranking when provider is undefined", async () => {
    const mockPrisma = {
      $queryRaw: vi.fn().mockImplementation(() => {
        return [
          { id: "a", title: "First", snippet: "first doc", fts_rank: 5.0 },
          { id: "b", title: "Second", snippet: "second doc", fts_rank: 4.0 },
          { id: "c", title: "Third", snippet: "third doc", fts_rank: 3.0 },
          { id: "d", title: "Fourth", snippet: "fourth doc", fts_rank: 2.0 },
          { id: "e", title: "Fifth", snippet: "fifth doc", fts_rank: 1.0 },
        ];
      }),
    };

    const results = await hybridSearch("user-1", "test", ["item"], null, mockPrisma, 5);
    expect(results.length).toBe(5);
    expect(results[0].entityId).toBe("a");
  });
});

describe("VoyageRerankProvider", () => {
  it("returns empty array for empty documents", async () => {
    const provider = new VoyageRerankProvider("test-api-key");
    const results = await provider.rerank("test query", []);
    expect(results).toEqual([]);
  });
});
