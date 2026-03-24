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
export { resolveModel, MODEL_MAP } from "./router.js";

// Skills
export { SkillRegistry } from "./skills/registry.js";
export type { Skill, SkillContext, SkillResult } from "./skills/types.js";
export { validateSkillArgs } from "./skills/validate-args.js";
export { scopedItems, scopedLists, scopedEvents } from "./skills/scoped-queries.js";
export { createRegistry } from "./skills/index.js";
