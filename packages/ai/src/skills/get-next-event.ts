import type { Skill } from "./types.js";
import { scopedEvents } from "./scoped-queries.js";

export const getNextEventSkill: Skill = {
  name: "get_next_event",
  description: "Get next upcoming calendar event.",
  parameters: {
    type: "object",
    properties: {},
  },
  modelTier: "small",
  requiresAI: false,

  async execute(_params, ctx) {
    const now = new Date();
    const events = await scopedEvents(ctx.prisma, ctx.userId);

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
        message: "No upcoming events on your calendar.",
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
          myResponseStatus: e.myResponseStatus,
        },
      },
      displayHint: { type: "detail" },
      message: `Next up: "${e.title}" at ${e.startTime.toLocaleTimeString()}.`,
    };
  },
};
