import type { EmbeddingProvider } from "./types.js";

interface VoyageEmbedResponse {
  data: Array<{ embedding: number[] }>;
  usage: { total_tokens: number };
}

export class VoyageEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions = 1024;
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async embed(text: string, inputType?: "query" | "document"): Promise<number[]> {
    const response = await this.callAPI([text], inputType);
    return response.data[0].embedding;
  }

  async embedBatch(texts: string[], inputType?: "query" | "document"): Promise<number[][]> {
    const response = await this.callAPI(texts, inputType);
    return response.data.map((d) => d.embedding);
  }

  private async callAPI(
    input: string[],
    inputType?: "query" | "document",
  ): Promise<VoyageEmbedResponse> {
    const body: Record<string, unknown> = {
      model: "voyage-3-large",
      input,
    };
    if (inputType) body.input_type = inputType;

    const res = await fetch("https://api.voyageai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Voyage AI API error ${res.status}: ${text}`);
    }

    return res.json() as Promise<VoyageEmbedResponse>;
  }
}
