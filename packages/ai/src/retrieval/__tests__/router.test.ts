import { describe, it, expect, vi, beforeEach } from "vitest";

// Mocks must be set up before importing the module under test
vi.mock("../../embedding/search.js", () => ({
  hybridSearch: vi.fn(),
}));
vi.mock("../../graph/query.js", () => ({
  findEntitiesBySimilarity: vi.fn(),
  buildGraphContext: vi.fn(),
}));

import { unifiedRetrieve } from "../router.js";
import { hybridSearch } from "../../embedding/search.js";
import { findEntitiesBySimilarity, buildGraphContext } from "../../graph/query.js";
import type { RetrievalContext } from "../types.js";

const mockHybridSearch = vi.mocked(hybridSearch);
const mockFindEntitiesBySimilarity = vi.mocked(findEntitiesBySimilarity);
const mockBuildGraphContext = vi.mocked(buildGraphContext);

function makeContext(overrides: Partial<RetrievalContext> = {}): RetrievalContext {
  return {
    userId: "user-1",
    query: "test query",
    ...overrides,
  };
}

function makeMockPrisma() {
  return {};
}

function makeSearchResult(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    entityType: "task",
    entityId: "task-1",
    title: "Test Task",
    snippet: "A test snippet",
    score: 0.9,
    matchType: "both" as const,
    metadata: {},
    ...overrides,
  };
}

describe("unifiedRetrieve", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHybridSearch.mockResolvedValue([]);
    mockFindEntitiesBySimilarity.mockResolvedValue([]);
    mockBuildGraphContext.mockResolvedValue("");
  });

  it("runs hybrid search and graph search in parallel, merges results", async () => {
    const searchResult = makeSearchResult();
    mockHybridSearch.mockResolvedValue([searchResult]);
    mockFindEntitiesBySimilarity.mockResolvedValue([{ id: "ent-1", name: "Jordan Chen" } as any]);
    mockBuildGraphContext.mockResolvedValue("Jordan Chen [person] —works_at→ Acme Corp [company]");

    const embeddingProvider = { embed: vi.fn().mockResolvedValue([0.1, 0.2]) } as any;
    const ctx = makeContext();
    const prisma = makeMockPrisma();

    const { results, graphContext } = await unifiedRetrieve(ctx, prisma, embeddingProvider);

    expect(mockHybridSearch).toHaveBeenCalledOnce();
    expect(mockFindEntitiesBySimilarity).toHaveBeenCalledOnce();
    expect(results).toHaveLength(1);
    expect(results[0].source).toBe("hybrid");
    expect(results[0].title).toBe("Test Task");
    expect(graphContext).toBe("Jordan Chen [person] —works_at→ Acme Corp [company]");
  });

  it("returns graph context from connected entities", async () => {
    mockFindEntitiesBySimilarity.mockResolvedValue([
      { id: "ent-1" } as any,
      { id: "ent-2" } as any,
    ]);
    mockBuildGraphContext.mockResolvedValue("Entity A —rel→ Entity B");

    const embeddingProvider = { embed: vi.fn() } as any;
    const { graphContext } = await unifiedRetrieve(makeContext(), makeMockPrisma(), embeddingProvider);

    expect(mockBuildGraphContext).toHaveBeenCalledWith("user-1", ["ent-1", "ent-2"], makeMockPrisma());
    expect(graphContext).toBe("Entity A —rel→ Entity B");
  });

  it("gracefully degrades when hybrid search fails (returns empty results)", async () => {
    mockHybridSearch.mockRejectedValue(new Error("Vector DB unavailable"));
    mockFindEntitiesBySimilarity.mockResolvedValue([]);

    const embeddingProvider = { embed: vi.fn() } as any;

    const { results, graphContext } = await unifiedRetrieve(makeContext(), makeMockPrisma(), embeddingProvider);

    expect(results).toHaveLength(0);
    expect(graphContext).toBe("");
  });

  it("gracefully degrades when graph search fails (returns empty graphContext)", async () => {
    const searchResult = makeSearchResult();
    mockHybridSearch.mockResolvedValue([searchResult]);
    mockFindEntitiesBySimilarity.mockRejectedValue(new Error("Graph search failed"));
    mockBuildGraphContext.mockResolvedValue("");

    const embeddingProvider = { embed: vi.fn() } as any;

    const { results, graphContext } = await unifiedRetrieve(makeContext(), makeMockPrisma(), embeddingProvider);

    expect(results).toHaveLength(1);
    expect(graphContext).toBe("");
  });

  it("works with null embedding provider (keyword-only, no graph)", async () => {
    const searchResult = makeSearchResult();
    mockHybridSearch.mockResolvedValue([searchResult]);

    const { results, graphContext } = await unifiedRetrieve(makeContext(), makeMockPrisma(), null);

    expect(mockHybridSearch).toHaveBeenCalledOnce();
    // Graph search is skipped when no embedding provider
    expect(mockFindEntitiesBySimilarity).not.toHaveBeenCalled();
    expect(results).toHaveLength(1);
    expect(graphContext).toBe("");
  });

  it("defaults maxResults to 10 when not specified", async () => {
    const ctx = makeContext(); // no maxResults
    const embeddingProvider = { embed: vi.fn() } as any;

    await unifiedRetrieve(ctx, makeMockPrisma(), embeddingProvider);

    // hybridSearch should have been called with limit=10
    expect(mockHybridSearch).toHaveBeenCalledWith(
      "user-1",
      "test query",
      null,
      embeddingProvider,
      expect.anything(),
      10,
      undefined,
    );
  });
});
