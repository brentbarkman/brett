import type { Skill } from "./types.js";

export const brettsTakeSkill: Skill = {
  name: "bretts_take",
  description:
    "Generate Brett's Take — an AI observation or insight about an item or event. Use when the user asks for Brett's opinion, thoughts, or analysis on a specific task or calendar event. Currently returns a placeholder.",
  parameters: {
    type: "object",
    properties: {
      itemId: { type: "string", description: "Item ID to analyze" },
      eventId: { type: "string", description: "Calendar event ID to analyze" },
    },
  },
  modelTier: "medium",
  requiresAI: true,

  async execute(_params, _ctx) {
    return {
      success: true,
      data: { placeholder: true },
      displayHint: { type: "text" },
      message:
        "Brett's Take generation coming soon. This will provide AI-powered observations and suggestions about your items and events.",
    };
  },
};
