import type { AIProviderName, ModelTier } from "@brett/types";

// When adding or changing models here, also update the pricing table
// in apps/admin-api/src/lib/pricing.ts so admin dashboard costs stay accurate.
export const MODEL_MAP: Record<AIProviderName, Record<ModelTier, string>> = {
  anthropic: {
    small: "claude-haiku-4-5-20251001",
    medium: "claude-sonnet-4-6",
    large: "claude-opus-4-6",
  },
  openai: {
    small: "gpt-4o-mini",
    medium: "gpt-4o",
    large: "o3",
  },
  google: {
    small: "gemini-2.0-flash-lite",
    medium: "gemini-2.0-flash",
    large: "gemini-2.5-pro",
  },
};

export function resolveModel(provider: AIProviderName, tier: ModelTier): string {
  return MODEL_MAP[provider][tier];
}
