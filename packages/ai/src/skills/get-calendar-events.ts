import type { Skill } from "./types.js";
import { scopedEvents } from "./scoped-queries.js";

export const getCalendarEventsSkill: Skill = {
  name: "get_calendar_events",
  description: "Query calendar events by date range.",
  parameters: {
    type: "object",
    properties: {
      startDate: { type: "string", description: "ISO 8601. Default: start of today." },
      endDate: { type: "string", description: "ISO 8601. Default: end of today." },
      date: { type: "string", description: "Single date (ISO 8601). Alt to startDate/endDate." },
    },
  },
  modelTier: "small",
  requiresAI: false,

  async execute(params, ctx) {
    const p = params as { startDate?: string; endDate?: string; date?: string };

    let start: Date;
    let end: Date;

    if (p.date) {
      start = new Date(p.date);
      start.setUTCHours(0, 0, 0, 0);
      end = new Date(p.date);
      end.setUTCHours(23, 59, 59, 999);
    } else {
      start = p.startDate ? new Date(p.startDate) : new Date();
      if (!p.startDate) start.setUTCHours(0, 0, 0, 0);
      end = p.endDate ? new Date(p.endDate) : new Date(start);
      if (!p.endDate) end.setUTCHours(23, 59, 59, 999);
    }

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return { success: false, message: "Invalid date format." };
    }

    const events = scopedEvents(ctx.prisma, ctx.userId);
    const results = await events.findMany({
      where: {
        startTime: { lte: end },
        endTime: { gte: start },
      },
      orderBy: { startTime: "asc" },
      take: 50,
    });

    const mapped = results.map((e) => ({
      id: e.id,
      title: e.title,
      startTime: e.startTime.toISOString(),
      endTime: e.endTime.toISOString(),
      isAllDay: e.isAllDay,
      location: e.location,
      meetingLink: e.meetingLink,
      myResponseStatus: e.myResponseStatus,
    }));

    return {
      success: true,
      data: { events: mapped },
      displayHint: { type: "list" },
      message: mapped.length > 0
        ? `Found ${mapped.length} event${mapped.length === 1 ? "" : "s"}.`
        : "No events found for that time range.",
    };
  },
};
