// @brett/ai — AI provider adapters, skill registry, memory system
// Public API will be exported from here as modules are built
export type {
  AIProvider,
  EmbeddingProvider,
  ChatParams,
  Message,
  ToolDefinition,
} from "./providers/types.js";
export { getProvider } from "./providers/factory.js";
export { OpenAIEmbeddingProvider } from "./providers/embedding.js";
export { VoyageEmbeddingProvider } from "./providers/voyage.js";
export { resolveModel, MODEL_MAP } from "./router.js";

// Skills
export { SkillRegistry } from "./skills/registry.js";
export type { Skill, SkillContext, SkillResult } from "./skills/types.js";
export { validateSkillArgs } from "./skills/validate-args.js";
export { scopedItems, scopedLists, scopedEvents } from "./skills/scoped-queries.js";
export { createRegistry } from "./skills/index.js";

// Config
export { AI_CONFIG } from "./config.js";

// Orchestrator
export { orchestrate } from "./orchestrator.js";
export type { OrchestratorParams } from "./orchestrator.js";

// Memory
export { extractFacts } from "./memory/facts.js";
export { embedConversation, searchSimilar } from "./memory/embeddings.js";
export { logUsage } from "./memory/usage.js";
export type { UsageEntry } from "./memory/usage.js";

// MCP
export type { MCPClient } from "./mcp/client.js";
export { createGranolaClient } from "./mcp/granola.js";

// Context
export {
  BRETT_SYSTEM_PROMPT,
  BRIEFING_SYSTEM_PROMPT,
  BRETTS_TAKE_SYSTEM_PROMPT,
  FACT_EXTRACTION_PROMPT,
} from "./context/system-prompts.js";
export { assembleContext } from "./context/assembler.js";
export type { AssemblerInput, AssembledContext } from "./context/assembler.js";
