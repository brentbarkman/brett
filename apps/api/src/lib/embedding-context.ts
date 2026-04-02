import { hybridSearch } from "@brett/ai";
import type { EmbeddingProvider } from "@brett/ai";
import type { PrismaClient } from "@prisma/client";

// Per-session cache — avoids redundant hybrid searches in multi-turn conversations.
// Key: "userId:sessionId", Value: { context, cachedAt }
const sessionCache = new Map<string, { context: string; cachedAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_CACHE_ENTRIES = 200;

// Periodic cleanup to prevent unbounded growth
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of sessionCache) {
    if (now - entry.cachedAt > CACHE_TTL_MS) sessionCache.delete(key);
  }
}, 60_000);

function formatResults(results: Array<{ entityType: string; snippet: string }>): string {
  return results
    .map((r) => {
      const snippet = r.snippet.slice(0, 300);
      const label = r.entityType === "conversation" ? "Past conversation" : r.entityType.replace("_", " ");
      return `[${label}] ${snippet}`;
    })
    .join("\n\n");
}

/**
 * Load relevant embedding context for a given text query.
 * Returns a formatted string of relevant snippets, or empty string if none found.
 *
 * When a sessionId is provided, caches the result for 5 minutes to avoid
 * redundant hybrid searches in multi-turn conversations about the same topic.
 */
export async function loadEmbeddingContext(
  userId: string,
  text: string,
  provider: EmbeddingProvider | null,
  prisma: PrismaClient,
  limit = 3,
  sessionId?: string,
): Promise<string> {
  // Check session cache for multi-turn conversations
  if (sessionId) {
    const cacheKey = `${userId}:${sessionId}`;
    const cached = sessionCache.get(cacheKey);
    if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
      return cached.context;
    }
  }

  try {
    const results = await hybridSearch(userId, text, null, provider, prisma, limit);
    const context = results.length === 0 ? "" : formatResults(results);

    // Cache for session reuse
    if (sessionId) {
      const cacheKey = `${userId}:${sessionId}`;
      // Evict oldest entries if cache is full
      if (sessionCache.size >= MAX_CACHE_ENTRIES) {
        const oldest = sessionCache.keys().next().value;
        if (oldest) sessionCache.delete(oldest);
      }
      sessionCache.set(cacheKey, { context, cachedAt: Date.now() });
    }

    return context;
  } catch (err) {
    // Embedding context is best-effort — never block the main request
    console.error("[embedding-context] Failed to load:", err);
    return "";
  }
}
