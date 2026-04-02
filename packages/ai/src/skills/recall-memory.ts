import type { Skill, SkillContext } from "./types.js";
import { hybridSearch } from "../embedding/search.js";

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

    const results = await hybridSearch(
      ctx.userId,
      query,
      null, // Search all entity types
      null, // No embedding provider from skill context — keyword search only
      ctx.prisma,
      5,
    );

    if (results.length === 0) {
      return {
        success: true,
        data: null,
        message: "No relevant past conversations found.",
      };
    }

    const formatted = results
      .map((r, i) => `${i + 1}. ${r.snippet.slice(0, 300)}`)
      .join("\n\n");

    return {
      success: true,
      data: { memories: results },
      message: `Found ${results.length} relevant past conversations:\n\n${formatted}`,
    };
  },
};
