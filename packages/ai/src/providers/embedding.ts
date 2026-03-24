import OpenAI from "openai";
import type { EmbeddingProvider } from "./types.js";

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions = 1536;
  private client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }

  async embed(text: string): Promise<number[]> {
    const response = await this.client.embeddings.create({
      model: "text-embedding-3-small",
      input: text,
    });
    return response.data[0].embedding;
  }
}
