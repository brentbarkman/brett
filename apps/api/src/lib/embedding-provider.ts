import { VoyageEmbeddingProvider } from "@brett/ai";
import type { EmbeddingProvider } from "@brett/ai";

let provider: EmbeddingProvider | null = null;

export function getEmbeddingProvider(): EmbeddingProvider | null {
  if (provider) return provider;
  const apiKey = process.env.EMBEDDING_API_KEY;
  if (!apiKey) return null;
  provider = new VoyageEmbeddingProvider(apiKey);
  return provider;
}

/** For tests: inject a mock provider */
export function setEmbeddingProvider(p: EmbeddingProvider | null): void {
  provider = p;
}
