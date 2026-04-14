import { VoyageEmbeddingProvider, VoyageRerankProvider } from "@brett/ai";
import type { EmbeddingProvider, RerankProvider } from "@brett/ai";

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

let rerankProvider: RerankProvider | null = null;

export function getRerankProvider(): RerankProvider | null {
  if (rerankProvider) return rerankProvider;
  const apiKey = process.env.EMBEDDING_API_KEY;
  if (!apiKey) return null;
  rerankProvider = new VoyageRerankProvider(apiKey);
  return rerankProvider;
}

/** For tests: inject a mock rerank provider */
export function setRerankProvider(p: RerankProvider | null): void {
  rerankProvider = p;
}
