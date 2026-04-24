export const AI_CONFIG = {
  orchestrator: {
    maxRounds: 5,
    maxTotalTokens: 50_000,
    maxToolResultSize: 4096,
    // Absolute wall-clock budget for a single orchestrate() call. The
    // provider already has a 2-minute per-chat timeout, but with maxRounds=5
    // and tool execution between rounds, a runaway loop could block a worker
    // for 10+ minutes. 2 minutes is plenty for any legitimate conversation.
    maxDurationMs: 120_000,
  },
  context: {
    maxFacts: 20,
    maxPastSessions: 3,
    maxMessagesPerSession: 15,
  },
  memory: {
    maxFactValueLength: 200,
    maxEmbeddingTextLength: 8000,
    embeddingDimensions: 1024,
  },
  embedding: {
    provider: "voyage" as const,
    documentModel: "voyage-4-large" as const,
    queryModel: "voyage-4-lite" as const,
    dimensions: 1024,
    maxChunkTokens: 500,
    chunkOverlapTokens: 50,
    maxTextLength: 8000,
    autoLinkThreshold: 0.90,
    suggestThreshold: 0.75,
    dupThreshold: 0.85,
    crossTypeThreshold: 0.70,
    scoutDedupThreshold: 0.88,
    searchResultLimit: 20,
    batchSize: 50,
    debounceMs: 500,
    maxRetries: 3,
  },
  rerank: {
    model: "rerank-2.5" as const,
    enabled: true,
    minCandidates: 5,
    topK: 10,
  },
  graph: {
    maxExtractionTextLength: 4000,
    maxEntitiesPerExtraction: 20,
    maxRelationshipsPerExtraction: 30,
    entityEmbedding: true,
    consolidationIntervalHours: 24,
  },
  extraction: {
    maxDailyPerUser: 200,
  },
  rateLimit: {
    aiStreaming: 30,
    aiConfig: 5,
    nonStreaming: 100,
  },
} as const;
