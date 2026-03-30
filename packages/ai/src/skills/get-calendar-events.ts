import type { Skill } from "./types.js";

export const getCalendarEventsSkill: Skill = {
  name: "get_calendar_events",
  description: "Query calendar events by date range. Results include action items and meeting notes availability when linked meeting notes exist.",
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

    const results = await ctx.prisma.calendarEvent.findMany({
      where: {
        userId: ctx.userId,
        startTime: { lte: end },
        endTime: { gte: start },
      },
      orderBy: { startTime: "asc" },
      take: 50,
      include: {
        meetingNotes: {
          select: {
            id: true,
            summary: true,
            actionItems: true,
          },
          take: 1,
        },
      },
    });

    const mapped = results.map((e) => {
      const meeting = e.meetingNotes[0];
      const actionItems = meeting?.actionItems;
      return {
        id: e.id,
        title: e.title,
        startTime: e.startTime.toISOString(),
        endTime: e.endTime.toISOString(),
        isAllDay: e.isAllDay,
        location: e.location,
        meetingLink: e.meetingLink,
        myResponseStatus: e.myResponseStatus,
        ...(meeting && {
          meetingNotes: meeting.summary ? "(available — ask to see notes)" : undefined,
          actionItems: Array.isArray(actionItems) && actionItems.length > 0
            ? (actionItems as { title: string; assignee?: string; dueDate?: string }[]).map((a) => ({
                title: a.title,
                assignee: a.assignee,
                dueDate: a.dueDate,
              }))
            : undefined,
        }),
      };
    });

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
