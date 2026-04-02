import { VoyageAIClient } from "voyageai";
import type { EmbeddingProvider } from "./types.js";

export class VoyageEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions = 1024;
  private client: VoyageAIClient;

  constructor(apiKey: string) {
    this.client = new VoyageAIClient({ apiKey });
  }

  async embed(text: string, inputType?: "query" | "document"): Promise<number[]> {
    const response = await this.client.embed({
      model: "voyage-3-large",
      input: text,
      inputType,
    });
    return response.data![0].embedding!;
  }

  async embedBatch(texts: string[], inputType?: "query" | "document"): Promise<number[][]> {
    const response = await this.client.embed({
      model: "voyage-3-large",
      input: texts,
      inputType,
    });
    return response.data!.map((d) => d.embedding!);
  }
}
