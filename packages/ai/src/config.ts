// AI platform configuration constants
export const AI_CONFIG = {
  orchestrator: {
    maxRounds: 5,
    maxTotalTokens: 50_000,
    maxToolResultSize: 4096,
  },
  context: {
    maxFacts: 20,           // was 50 — most users have <20 facts, saves ~1,500 tokens
    maxPastSessions: 3,     // was 5 — older sessions rarely relevant, saves ~3,000 tokens
    maxMessagesPerSession: 15, // was 20
  },
  memory: {
    maxFactValueLength: 200,
    maxEmbeddingTextLength: 8000,
    embeddingDimensions: 1536,
  },
  rateLimit: {
    aiStreaming: 30, // per minute
    aiConfig: 5, // per minute
    nonStreaming: 100, // per minute
  },
} as const;
