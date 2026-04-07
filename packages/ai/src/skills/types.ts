import type { ModelTier, DisplayHint } from "@brett/types";
import type { PrismaClient } from "@brett/api-core";
import type { AIProvider, EmbeddingProvider } from "../providers/types.js";

export interface SkillContext {
  userId: string;
  prisma: PrismaClient;
  provider?: AIProvider;
  /** Optional embedding provider for semantic search in skills */
  embeddingProvider?: EmbeddingProvider | null;
  /** Fire-and-forget callback for content items that need extraction */
  onContentCreated?: (itemId: string, sourceUrl: string) => void;
}

export interface SkillResult {
  success: boolean;
  data?: unknown;
  displayHint?: DisplayHint;
  message?: string;
}

export interface Skill {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
  modelTier: ModelTier;
  requiresAI: boolean;
  execute(params: unknown, ctx: SkillContext): Promise<SkillResult>;
}
