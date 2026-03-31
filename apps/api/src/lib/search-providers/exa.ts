import Exa from "exa-js";
import type { SearchProvider, SearchOptions, SearchResult } from "./types.js";

export class ExaSearchProvider implements SearchProvider {
  private client: Exa;

  constructor(apiKey: string) {
    this.client = new Exa(apiKey);
  }

  async search(query: string, options?: SearchOptions): Promise<SearchResult[]> {
    try {
      // Calculate startPublishedDate from days option
      const startPublishedDate = options?.days
        ? new Date(Date.now() - options.days * 86400000).toISOString()
        : undefined;

      if (options?.includeContent) {
        const response = await this.client.searchAndContents(query, {
          numResults: options?.maxResults ?? 10,
          includeDomains: options?.domains,
          startPublishedDate,
          text: true,
        });

        return (response.results ?? []).map((r) => ({
          title: r.title ?? "",
          url: r.url ?? "",
          snippet: r.text.slice(0, 500),
          content: r.text,
          publishedDate: r.publishedDate ?? undefined,
          score: r.score ?? undefined,
        }));
      }

      // No content requested — use basic search without text contents
      const response = await this.client.searchAndContents(query, {
        numResults: options?.maxResults ?? 10,
        includeDomains: options?.domains,
        startPublishedDate,
      });

      return (response.results ?? []).map((r) => ({
        title: r.title ?? "",
        url: r.url ?? "",
        // Without text contents, r.text is not present — use empty string
        snippet: "",
        content: undefined,
        publishedDate: r.publishedDate ?? undefined,
        score: r.score ?? undefined,
      }));
    } catch (err) {
      console.error("[exa] Search failed:", err);
      return [];
    }
  }
}
