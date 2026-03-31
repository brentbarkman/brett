import { tavily } from "@tavily/core";
import type { SearchProvider, SearchOptions, SearchResult } from "./types.js";

export class TavilySearchProvider implements SearchProvider {
  private client: ReturnType<typeof tavily>;

  constructor(apiKey: string) {
    this.client = tavily({ apiKey });
  }

  async search(query: string, options?: SearchOptions): Promise<SearchResult[]> {
    try {
      const response = await this.client.search(query, {
        maxResults: options?.maxResults ?? 10,
        searchDepth: options?.searchDepth ?? "basic",
        includeRawContent: options?.includeContent ? "text" : false,
        includeDomains: options?.domains,
        days: options?.days,
        topic: options?.topic ?? "general",
      });

      return (response.results ?? []).map((r) => ({
        title: r.title ?? "",
        url: r.url ?? "",
        snippet: r.content ?? "",
        content: r.rawContent ?? undefined,
        // publishedDate and score are always present on TavilySearchResult but may
        // be empty strings or 0 — normalize to undefined when falsy
        publishedDate: r.publishedDate || undefined,
        score: r.score,
      }));
    } catch (err) {
      console.error("[tavily] Search failed:", err);
      return [];
    }
  }
}
