import type { Skill } from "./types.js";

export const recallMemorySkill: Skill = {
  name: "recall_memory",
  description:
    "Search through stored memories and context using vector embeddings. Use when the user asks Brett to remember something, or asks 'what did I say about...?', 'do you remember...?'. Currently a placeholder — vector memory (Layer C) not yet built.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "The memory search query",
      },
    },
    required: ["query"],
  },
  modelTier: "small",
  requiresAI: false,

  async execute(_params, _ctx) {
    return {
      success: true,
      data: { placeholder: true, memories: [] },
      displayHint: { type: "text" },
      message:
        "Memory recall coming soon. This will search through Brett's stored context and past conversations to find relevant information.",
    };
  },
};
