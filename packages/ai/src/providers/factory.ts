import type { AIProviderName } from "@brett/types";
import type { AIProvider } from "./types.js";
import { AnthropicProvider } from "./anthropic.js";
import { OpenAIProvider } from "./openai.js";
import { GoogleProvider } from "./google.js";

export function getProvider(name: AIProviderName, apiKey: string): AIProvider {
  switch (name) {
    case "anthropic":
      return new AnthropicProvider(apiKey);
    case "openai":
      return new OpenAIProvider(apiKey);
    case "google":
      return new GoogleProvider(apiKey);
    default:
      throw new Error(`Unknown AI provider: ${name}`);
  }
}
