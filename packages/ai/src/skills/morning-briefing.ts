import type { Skill } from "./types.js";

export const morningBriefingSkill: Skill = {
  name: "morning_briefing",
  description:
    "Generate a morning briefing summarizing the user's day. Use when the user asks for a briefing, daily summary, or 'what does my day look like?'. Currently returns a placeholder — full generation coming when orchestrator is built.",
  parameters: {
    type: "object",
    properties: {},
  },
  modelTier: "medium",
  requiresAI: true,

  async execute(_params, _ctx) {
    return {
      success: true,
      data: { placeholder: true },
      displayHint: { type: "text" },
      message:
        "Morning briefing generation coming soon. This will summarize your tasks, calendar events, and things that need attention today.",
    };
  },
};
