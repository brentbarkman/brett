import type { Skill } from "./types.js";
import { scopedEvents } from "./scoped-queries.js";

export const upNextSkill: Skill = {
  name: "up_next",
  description:
    "Find the next calendar event and return it with any cached Brett observation. Use when the user asks 'what's up next?', 'what should I focus on?', or needs a quick glance at what's coming.",
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
