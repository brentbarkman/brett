import type { Skill } from "./types.js";
import { scopedEvents } from "./scoped-queries.js";

export const getNextEventSkill: Skill = {
  name: "get_next_event",
  description:
    "Get the next upcoming calendar event starting after right now. ONLY for calendar/meeting questions. Use when the user explicitly asks about their next MEETING or CALENDAR event, e.g., 'what's my next meeting?', 'when is my next call?'. Do NOT use for general 'what's next?' questions about tasks.",
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
