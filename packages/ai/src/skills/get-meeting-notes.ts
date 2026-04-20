import type { Skill } from "./types.js";
import { findMeetingByQuery, findMeetingsByQuery } from "./meeting-search.js";
import { getCalendarDateBounds } from "@brett/business";

const DEFAULT_TIMEZONE = "America/Los_Angeles";

export const getMeetingNotesSkill: Skill = {
  name: "get_meeting_notes",
  description:
    "Retrieve meeting notes and summaries. ALWAYS use this (not search_things) when the user asks what happened in a meeting, what was discussed, or wants meeting notes. Searches by person name, meeting title, topic, date, or attendee.",
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
          "Person name, meeting title, topic, or date (YYYY-MM-DD). Searches titles, calendar events, and attendees. E.g. 'Dan Cole', 'sprint planning', '2026-03-27'.",
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
      let meeting = await ctx.prisma.meetingNote.findFirst({
        where: { calendarEventId: p.calendarEventId, userId: ctx.userId },
      });

      // Fallback: the matcher may have missed linking this meeting to
      // its CalendarEvent (zero-width intervals + drifted timezones in
      // Granola's payload have broken this before). Look up the event
      // itself and find an unlinked MeetingNote with a matching title
      // within ±12h — enough to absorb any residual drift.
      if (!meeting) {
        const calEvent = await ctx.prisma.calendarEvent.findFirst({
          where: { id: p.calendarEventId, userId: ctx.userId },
          select: { title: true, startTime: true },
        });
        if (calEvent) {
          const HALF_DAY_MS = 12 * 60 * 60 * 1000;
          const candidates = await ctx.prisma.meetingNote.findMany({
            where: {
              userId: ctx.userId,
              meetingStartedAt: {
                gte: new Date(calEvent.startTime.getTime() - HALF_DAY_MS),
                lte: new Date(calEvent.startTime.getTime() + HALF_DAY_MS),
              },
            },
            orderBy: { meetingStartedAt: "asc" },
          });
          meeting =
            candidates.find((m) =>
              titleMatchesCalendarEvent(m.title, calEvent.title),
            ) ?? null;
        }
      }

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
        // Use timezone-aware bounds — never use "T00:00:00Z" which assumes
        // UTC midnight and misses meetings near day boundaries.
        const tz = (await ctx.prisma.user.findUnique({
          where: { id: ctx.userId },
          select: { timezone: true },
        }))?.timezone ?? DEFAULT_TIMEZONE;
        const { startOfDay, endOfDay } = getCalendarDateBounds(p.query, tz);

        const meetings = await ctx.prisma.meetingNote.findMany({
          where: {
            userId: ctx.userId,
            meetingStartedAt: { gte: startOfDay, lte: endOfDay },
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

      // Search by title, calendar event title, and attendee names
      const meetings = await findMeetingsByQuery(ctx.prisma, ctx.userId, p.query, 5);

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
    const meetings = await ctx.prisma.meetingNote.findMany({
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

/**
 * Relaxed title match for the fallback path. Either side may contain
 * the other — Granola's title sometimes trims the calendar event's
 * prefix (e.g. "[VC] Intros: Brent x Swetha" vs "Intros: Brent x Swetha").
 */
export function titleMatchesCalendarEvent(
  meetingTitle: string,
  calendarEventTitle: string,
): boolean {
  const m = meetingTitle.trim().toLowerCase();
  const c = calendarEventTitle.trim().toLowerCase();
  if (!m || !c) return false;
  return m === c || m.includes(c) || c.includes(m);
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
