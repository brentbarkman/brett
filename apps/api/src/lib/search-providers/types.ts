export interface SearchOptions {
  maxResults?: number;
  searchDepth?: "basic" | "advanced";
  includeContent?: boolean;
  domains?: string[];
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
