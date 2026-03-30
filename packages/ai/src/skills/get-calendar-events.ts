import type { Skill } from "./types.js";
import { getCalendarDateBounds, getUserDayBounds } from "@brett/business";

const DEFAULT_TIMEZONE = "America/Los_Angeles";

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

    // Look up user timezone for date-only string handling
    const tz = (await ctx.prisma.user.findUnique({
      where: { id: ctx.userId },
      select: { timezone: true },
    }))?.timezone ?? DEFAULT_TIMEZONE;

    let start: Date;
    let end: Date;

    if (p.date) {
      // Date-only strings need timezone-aware bounds — never use setUTCHours()
      // which assumes UTC midnight and shifts events near day boundaries.
      const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(p.date);
      if (isDateOnly) {
        const bounds = getCalendarDateBounds(p.date, tz);
        start = bounds.startOfDay;
        end = bounds.endOfDay;
      } else {
        start = new Date(p.date);
        end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
      }
    } else {
      if (p.startDate) {
        start = new Date(p.startDate);
      } else {
        // Default to start of today in user's timezone
        const bounds = getUserDayBounds(tz);
        start = bounds.startOfDay;
      }
      if (p.endDate) {
        end = new Date(p.endDate);
      } else {
        // Default to end of today in user's timezone
        const bounds = getUserDayBounds(tz);
        end = bounds.endOfDay;
      }
    }

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return { success: false, message: "Invalid date format." };
    }

    // Only include events from visible calendars
    const visibleCalendars = await ctx.prisma.calendarList.findMany({
      where: { googleAccount: { userId: ctx.userId }, isVisible: true },
      select: { id: true },
    });
    const calendarListIds = visibleCalendars.map((c) => c.id);

    const results = await ctx.prisma.calendarEvent.findMany({
      where: {
        userId: ctx.userId,
        calendarListId: { in: calendarListIds },
        startTime: { lte: end },
        endTime: { gte: start },
        status: { not: "cancelled" },
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
