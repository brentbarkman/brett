import type { EmbeddingProvider, RerankProvider } from "../providers/types.js";
import type { RetrievalContext, RetrievalResult } from "./types.js";
import { hybridSearch } from "../embedding/search.js";
import { findEntitiesBySimilarity, buildGraphContext } from "../graph/query.js";

/**
 * Unified retrieval router that combines hybrid search (keyword + vector)
 * with knowledge graph context. Does NOT query UserFact — facts are loaded
 * separately by the context assembler.
 */
export async function unifiedRetrieve(
  ctx: RetrievalContext,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prisma: any,
  embeddingProvider: EmbeddingProvider | null,
  rerankProvider?: RerankProvider | null,
): Promise<{ results: RetrievalResult[]; graphContext: string }> {
  const limit = ctx.maxResults ?? 10;

  // Run hybrid search and graph entity search in parallel
  const [hybridResults, graphEntities] = await Promise.all([
    hybridSearch(ctx.userId, ctx.query, null, embeddingProvider, prisma, limit, rerankProvider).catch(
      (err) => {
        console.error("[retrieval] hybrid search failed:", err.message);
        return [];
      },
    ),
    embeddingProvider
      ? findEntitiesBySimilarity(ctx.userId, ctx.query, embeddingProvider, prisma, 5).catch(() => [])
      : Promise.resolve([]),
  ]);

  const results: RetrievalResult[] = hybridResults.map((r) => ({
    source: "hybrid" as const,
    entityType: r.entityType,
    entityId: r.entityId,
    title: r.title,
    content: r.snippet,
    score: r.score,
    metadata: r.metadata,
  }));

  const graphEntityIds = graphEntities.map((e) => e.id);
  const graphContext = await buildGraphContext(ctx.userId, graphEntityIds, prisma).catch(() => "");

  return { results, graphContext };
}
