import type { Skill, SkillContext } from "./types.js";
import { unifiedRetrieve } from "../retrieval/router.js";

export const recallMemorySkill: Skill = {
  name: "recall_memory",
  description:
    "Search through past conversations and stored content using semantic search. Use when the user asks about past discussions, previous decisions, or 'what did we talk about'.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "What to search for in memory",
      },
    },
    required: ["query"],
  },
  modelTier: "small",
  requiresAI: false,

  async execute(params: unknown, ctx: SkillContext) {
    const { query } = params as { query: string };

    const { results, graphContext } = await unifiedRetrieve(
      { userId: ctx.userId, query },
      ctx.prisma,
      ctx.embeddingProvider ?? null,
      ctx.rerankProvider,
    );

    if (results.length === 0 && !graphContext) {
      return {
        success: true,
        data: null,
        message: "No relevant past conversations found.",
      };
    }

    const formatted = results
      .map((r, i) => `${i + 1}. ${r.content.slice(0, 300)}`)
      .join("\n\n");

    const message = [
      `Found ${results.length} relevant past conversations:\n\n${formatted}`,
      graphContext ? `\nGraph context:\n${graphContext}` : "",
    ]
      .filter(Boolean)
      .join("");

    return {
      success: true,
      data: { memories: results },
      message,
    };
  },
};
