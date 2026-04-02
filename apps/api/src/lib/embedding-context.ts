import { hybridSearch } from "@brett/ai";
import type { EmbeddingProvider } from "@brett/ai";
import type { PrismaClient } from "@prisma/client";

/**
 * Load relevant embedding context for a given text query.
 * Returns a formatted string of relevant snippets, or empty string if none found.
 *
 * Used by API routes to enrich assembler inputs with semantic search results
 * before passing them to the orchestrator. This runs at the API layer because
 * the embedding provider singleton lives here, not in @brett/ai.
 */
export async function loadEmbeddingContext(
  userId: string,
  text: string,
  provider: EmbeddingProvider | null,
  prisma: PrismaClient,
  limit = 3,
): Promise<string> {
  try {
    const results = await hybridSearch(userId, text, null, provider, prisma, limit);
    if (results.length === 0) return "";

    return results
      .map((r) => {
        const snippet = r.snippet.slice(0, 300);
        const label = r.entityType === "conversation" ? "Past conversation" : r.entityType.replace("_", " ");
        return `[${label}] ${snippet}`;
      })
      .join("\n\n");
  } catch (err) {
    // Embedding context is best-effort — never block the main request
    console.error("[embedding-context] Failed to load:", err);
    return "";
  }
}
