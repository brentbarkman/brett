export interface SearchOptions {
  maxResults?: number;
  searchDepth?: "basic" | "advanced";
  includeContent?: boolean;
  domains?: string[];
  /** Only return results published within this many days */
  days?: number;
  /** Topic hint for providers that support it (e.g., Tavily: "news", "finance") */
  topic?: "general" | "news" | "finance";
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  content?: string;
  publishedDate?: string;
  score?: number;
}

export interface SearchProvider {
  search(query: string, options?: SearchOptions): Promise<SearchResult[]>;
}
