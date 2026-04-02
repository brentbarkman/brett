import type { EmbeddingProvider } from "../providers/types.js";
import { embedEntity } from "../embedding/pipeline.js";
import { hybridSearch } from "../embedding/search.js";

export async function embedConversation(
  sessionId: string,
  userId: string,
  provider: EmbeddingProvider,
  prisma: any,
): Promise<void> {
  await embedEntity({ entityType: "conversation", entityId: sessionId, userId, provider, prisma });
}

export async function searchSimilar(
  userId: string,
  query: string,
  provider: EmbeddingProvider | null,
  prisma: any,
  limit: number = 5,
): Promise<Array<{ chunkText: string; similarity: number }>> {
  const results = await hybridSearch(userId, query, ["conversation"], provider, prisma, limit);
  return results.map((r) => ({ chunkText: r.snippet, similarity: r.score }));
}
