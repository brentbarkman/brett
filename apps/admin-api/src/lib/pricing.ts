// Per-model pricing in USD per 1M tokens (input / output)
// Source: https://docs.anthropic.com/en/docs/about-claude/pricing
// Last updated: 2026-04-01
//
// NOTE: AIUsageLog does not currently track batch vs non-batch.
// All costs are calculated at standard (non-batch) rates.
// Batch API is 50% of standard. When batch tracking is added,
// update estimateCost to accept a `batch` flag.

export const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  // Current models (match actual model IDs stored in AIUsageLog)
  "claude-opus-4-6":            { input: 5.0,   output: 25.0  },
  "claude-sonnet-4-6":          { input: 3.0,   output: 15.0  },
  "claude-haiku-4-5-20251001":  { input: 1.0,   output: 5.0   },
  "claude-haiku-4-5":           { input: 1.0,   output: 5.0   },

  // Legacy models (may appear in historical data)
  "claude-opus-4-5-20251101":   { input: 5.0,   output: 25.0  },
  "claude-opus-4-1-20250805":   { input: 15.0,  output: 75.0  },
  "claude-sonnet-4-20250514":   { input: 3.0,   output: 15.0  },
  "claude-sonnet-4-5-20250929": { input: 3.0,   output: 15.0  },
  "claude-opus-4-20250514":     { input: 15.0,  output: 75.0  },
  "claude-3-haiku-20240307":    { input: 0.25,  output: 1.25  },
  "claude-3-5-haiku-20241022":  { input: 0.80,  output: 4.0   },
};

const DEFAULT_PRICING = { input: 3.0, output: 15.0 }; // Sonnet-tier as safe default

export function estimateCost(model: string | null, inputTokens: number, outputTokens: number): number {
  const pricing = MODEL_PRICING[model ?? ""] ?? DEFAULT_PRICING;
  return (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000;
}
