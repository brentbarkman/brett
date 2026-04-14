import type { RerankProvider, RerankResult } from "./types.js";
import { AI_CONFIG } from "../config.js";

export class VoyageRerankProvider implements RerankProvider {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async rerank(query: string, documents: string[], topK?: number): Promise<RerankResult[]> {
    if (documents.length === 0) return [];

    const response = await fetch("https://api.voyageai.com/v1/rerank", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: AI_CONFIG.rerank.model,
        query,
        documents,
        top_k: topK ?? documents.length,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Voyage Rerank API error ${response.status}: ${text}`);
    }

    const data = (await response.json()) as {
      data: Array<{ index: number; relevance_score: number }>;
    };

    return data.data.map((d) => ({
      index: d.index,
      relevanceScore: d.relevance_score,
    }));
  }
}
