import type { Skill } from "./types.js";
import { scopedEvents } from "./scoped-queries.js";

export const upNextSkill: Skill = {
  name: "up_next",
  description:
    "Get a combined overview of what the user should focus on next — their next calendar event plus any relevant task context. Use for general questions like 'what's up next?', 'what should I focus on?', 'what's next?'. This is the DEFAULT for vague \"what's next\" questions. Prefer this over get_next_event unless the user specifically mentions meetings or calendar.",
  parameters: {
    type: "object",
    properties: {},
  },
  modelTier: "small",
  requiresAI: false,

  async execute(_params, ctx) {
    const now = new Date();
    const events = scopedEvents(ctx.prisma, ctx.userId);

    const results = await events.findMany({
      where: {
        startTime: { gte: now },
        isAllDay: false,
      },
      orderBy: { startTime: "asc" },
      take: 1,
    });

    if (results.length === 0) {
      return {
        success: true,
        data: { event: null },
        displayHint: { type: "text" },
        message: "Nothing coming up on your calendar.",
      };
    }

    const e = results[0];
    return {
      success: true,
      data: {
        event: {
          id: e.id,
          title: e.title,
          startTime: e.startTime.toISOString(),
          endTime: e.endTime.toISOString(),
          location: e.location,
          meetingLink: e.meetingLink,
        },
      },
      displayHint: { type: "detail" },
      message: `Up next: "${e.title}" at ${e.startTime.toLocaleTimeString()}.`,
    };
  },
};
