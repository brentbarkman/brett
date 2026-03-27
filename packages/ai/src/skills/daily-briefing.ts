import type { Skill } from "./types.js";

export const dailyBriefingSkill: Skill = {
  name: "daily_briefing",
  description:
    "Generate a daily briefing summarizing the user's day. Use when the user asks for a briefing, daily summary, or 'what does my day look like?'. Currently returns a placeholder — full generation coming when orchestrator is built.",
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
        "Daily briefing generation coming soon. This will summarize your tasks, calendar events, and things that need attention today.",
    };
  },
};
