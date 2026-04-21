// @brett/ai — AI provider adapters, skill registry, memory system
// Public API will be exported from here as modules are built
export type {
  AIProvider,
  EmbeddingProvider,
  RerankProvider,
  RerankResult,
  ChatParams,
  Message,
  ToolDefinition,
} from "./providers/types.js";
export { getProvider } from "./providers/factory.js";
export { OpenAIEmbeddingProvider } from "./providers/embedding.js";
export { VoyageEmbeddingProvider } from "./providers/voyage.js";
export { VoyageRerankProvider } from "./providers/voyage-rerank.js";
export { resolveModel, MODEL_MAP } from "./router.js";

// Skills
export { SkillRegistry } from "./skills/registry.js";
export type { Skill, SkillContext, SkillResult } from "./skills/types.js";
export { validateSkillArgs } from "./skills/validate-args.js";
export { scopedItems, scopedLists, scopedEvents } from "./skills/scoped-queries.js";
export { createRegistry } from "./skills/index.js";

// Config
export { AI_CONFIG } from "./config.js";

// Embedding providers
export { MockEmbeddingProvider, cosineSimilarity } from "./providers/mock-embedding.js";

// Embedding pipeline
export { embedEntity, deleteEmbeddings } from "./embedding/pipeline.js";
export type { EmbedEntityParams } from "./embedding/pipeline.js";
export { enqueueEmbed, setEmbedProcessor, flushEmbedQueue } from "./embedding/queue.js";
export type { EmbedJob } from "./embedding/queue.js";
export {
  assembleItemText,
  assembleContentText,
  assembleEventText,
  assembleMeetingNoteText,
  assembleFindingText,
  assembleConversationText,
} from "./embedding/assembler.js";
export type {
  ItemAssemblerInput,
  ContentAssemblerInput,
  EventAssemblerInput,
  MeetingNoteAssemblerInput,
  FindingAssemblerInput,
  ConversationMessage,
  TranscriptEntry,
} from "./embedding/assembler.js";
export { chunkText, estimateTokens } from "./embedding/chunker.js";
export {
  hybridSearch,
  keywordSearch,
  vectorSearch,
  fuseResults,
  VALID_ENTITY_TYPES,
} from "./embedding/search.js";
export type { SearchResult, RankedResult } from "./embedding/search.js";
export {
  findSimilarItems,
  findDuplicates,
  classifyMatches,
  suggestLists,
} from "./embedding/similarity.js";
export type { SimilarityMatch, ClassifiedMatches } from "./embedding/similarity.js";

// Orchestrator
export { orchestrate } from "./orchestrator.js";
export type { OrchestratorParams } from "./orchestrator.js";

// Memory
export { extractFacts } from "./memory/facts.js";
export { extractEntityFacts } from "./memory/entity-facts.js";
export {
  validateFacts,
  parseLLMFactResponse,
  INJECTION_PATTERN,
  TAG_INJECTION_PATTERN,
  VALID_CATEGORIES,
} from "./memory/validation.js";
export type { RawFact } from "./memory/validation.js";
export { embedConversation, searchSimilar } from "./memory/embeddings.js";
export { logUsage } from "./memory/usage.js";
export type { UsageEntry } from "./memory/usage.js";
export { consolidateUserMemory, runConsolidation } from "./memory/consolidation.js";
export {
  buildUserProfile,
  getCachedUserProfile,
  invalidateProfileCache,
  formatProfileForPrompt,
} from "./memory/user-profile.js";
export type { UserProfile } from "./memory/user-profile.js";

// Graph extraction
export { extractGraph, parseAndValidate as parseAndValidateGraph } from "./graph/extractor.js";
export { upsertGraph } from "./graph/store.js";
export type { ExtractedEntity, ExtractedRelationship, ExtractionResult } from "./graph/types.js";
export { VALID_GRAPH_ENTITY_TYPES, VALID_RELATIONSHIP_TYPES } from "./graph/types.js";
export { findConnected, findEntitiesBySimilarity, buildGraphContext } from "./graph/query.js";

// Retrieval
export { unifiedRetrieve } from "./retrieval/router.js";
export type { RetrievalContext, RetrievalResult } from "./retrieval/types.js";

// Context
export {
  getSystemPrompt,
  getBriefingPrompt,
  getBrettsTakePrompt,
  getFactExtractionPrompt,
  SCOUT_CREATION_PROMPT,
  SECURITY_BLOCK,
} from "./context/system-prompts.js";
export { assembleContext } from "./context/assembler.js";
export type { AssemblerInput, AssembledContext } from "./context/assembler.js";

// Prompts — extracted from their call sites so the eval harness can import
// the same text production uses.
export { GRAPH_EXTRACTION_PROMPT } from "./graph/extractor.js";
export { getEntityFactExtractionPrompt } from "./memory/entity-facts.js";
export { MEETING_PATTERN_PROMPT } from "./skills/analyze-meeting-pattern.js";
export {
  buildScoutQueryPrompt,
  buildScoutJudgmentPrompt,
  SCOUT_QUERY_SCHEMA,
  SCOUT_JUDGMENT_SCHEMA,
} from "./prompts/scout.js";
export type { ScoutQueryPromptOpts, ScoutJudgmentPromptOpts } from "./prompts/scout.js";
export { buildActionItemsPrompt, ACTION_ITEMS_SCHEMA } from "./prompts/action-items.js";
export type { ActionItemsPromptInput } from "./prompts/action-items.js";
