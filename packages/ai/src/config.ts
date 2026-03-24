// AI platform configuration constants
export const AI_CONFIG = {
  orchestrator: {
    maxRounds: 5,
    maxTotalTokens: 50_000,
    maxToolResultSize: 4096,
  },
  context: {
    maxFacts: 50,
    maxPastSessions: 5,
    maxMessagesPerSession: 20,
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
