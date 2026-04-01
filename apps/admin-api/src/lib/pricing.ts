// Per-model pricing in USD per 1M tokens (input / output)
// Update when provider pricing changes
export const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  "claude-sonnet-4-20250514": { input: 3.0, output: 15.0 },
  "claude-haiku-3-20240307": { input: 0.25, output: 1.25 },
  "claude-3-5-haiku-20241022": { input: 1.0, output: 5.0 },
};

const DEFAULT_PRICING = { input: 3.0, output: 15.0 };

export function estimateCost(model: string | null, inputTokens: number, outputTokens: number): number {
  const pricing = MODEL_PRICING[model ?? ""] ?? DEFAULT_PRICING;
  return (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000;
}
