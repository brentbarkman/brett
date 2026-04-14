export interface RetrievalContext {
  userId: string;
  query: string;
  sessionId?: string;
  maxResults?: number;
}

export interface RetrievalResult {
  source: "vector" | "keyword" | "graph" | "memory" | "hybrid";
  entityType: string;
  entityId?: string;
  title: string;
  content: string;
  score: number;
  metadata?: Record<string, unknown>;
}
