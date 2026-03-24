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
