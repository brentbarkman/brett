import type { Skill } from "./types.js";

export const getMeetingNotesSkill: Skill = {
  name: "get_meeting_notes",
  description:
    "Retrieve meeting notes and summaries. Use when the user asks about what happened in a meeting, what was discussed, or wants meeting notes. Can search by calendar event ID, date, or text query.",
  parameters: {
    type: "object",
    properties: {
      calendarEventId: {
        type: "string",
        description: "Calendar event ID to look up meeting notes for",
      },
      query: {
        type: "string",
        description:
          "Search query — a meeting title (partial match) or date (YYYY-MM-DD)",
      },
    },
  },
  modelTier: "small",
  requiresAI: false,

  async execute(params, ctx) {
    const p = params as {
      calendarEventId?: string;
      query?: string;
    };

    // 1. Lookup by calendar event ID
    if (p.calendarEventId) {
      const meeting = await ctx.prisma.granolaMeeting.findFirst({
        where: { calendarEventId: p.calendarEventId, userId: ctx.userId },
      });

      if (!meeting) {
        return {
          success: true,
          data: null,
          displayHint: { type: "text" },
          message: "No meeting notes found for that calendar event.",
        };
      }

      return {
        success: true,
        data: { meetingId: meeting.id, title: meeting.title },
        displayHint: { type: "text" },
        message: formatMeeting(meeting),
      };
    }

    // 2. Search by query (title or date)
    if (p.query) {
      const isDate = /^\d{4}-\d{2}-\d{2}$/.test(p.query);

      if (isDate) {
        const dayStart = new Date(p.query + "T00:00:00Z");
        const dayEnd = new Date(p.query + "T23:59:59.999Z");

        const meetings = await ctx.prisma.granolaMeeting.findMany({
          where: {
            userId: ctx.userId,
            meetingStartedAt: { gte: dayStart, lte: dayEnd },
          },
          orderBy: { meetingStartedAt: "asc" },
        });

        if (meetings.length === 0) {
          return {
            success: true,
            data: null,
            displayHint: { type: "text" },
            message: `No meetings found on ${p.query}.`,
          };
        }

        return {
          success: true,
          data: meetings.map((m) => ({ meetingId: m.id, title: m.title })),
          displayHint: { type: "text" },
          message: meetings.map(formatMeeting).join("\n\n---\n\n"),
        };
      }

      // Title search (case-insensitive contains)
      const meetings = await ctx.prisma.granolaMeeting.findMany({
        where: {
          userId: ctx.userId,
          title: { contains: p.query, mode: "insensitive" },
        },
        orderBy: { meetingStartedAt: "desc" },
        take: 5,
      });

      if (meetings.length === 0) {
        return {
          success: true,
          data: null,
          displayHint: { type: "text" },
          message: `No meetings found matching "${p.query}".`,
        };
      }

      return {
        success: true,
        data: meetings.map((m) => ({ meetingId: m.id, title: m.title })),
        displayHint: { type: "text" },
        message: meetings.map(formatMeeting).join("\n\n---\n\n"),
      };
    }

    // 3. No params — return 3 most recent meetings
    const meetings = await ctx.prisma.granolaMeeting.findMany({
      where: { userId: ctx.userId },
      orderBy: { meetingStartedAt: "desc" },
      take: 3,
    });

    if (meetings.length === 0) {
      return {
        success: true,
        data: null,
        displayHint: { type: "text" },
        message: "No meeting notes found. Meetings will appear here once synced from Granola.",
      };
    }

    return {
      success: true,
      data: meetings.map((m) => ({ meetingId: m.id, title: m.title })),
      displayHint: { type: "text" },
      message:
        "**Recent meetings:**\n\n" +
        meetings.map(formatMeeting).join("\n\n---\n\n"),
    };
  },
};

// ─── Helpers ───

interface MeetingRow {
  id: string;
  title: string;
  summary: string | null;
  meetingStartedAt: Date;
}

function formatMeeting(m: MeetingRow): string {
  const date = m.meetingStartedAt.toISOString().split("T")[0];
  const lines = [`**${m.title}** (${date})`];
  if (m.summary) {
    lines.push("", m.summary);
  } else {
    lines.push("", "_No summary available._");
  }
  return lines.join("\n");
}
