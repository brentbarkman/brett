import type { CalendarEvent } from "@brett/api-core";
import type { MeetingNoteProvider, ProviderMeetingData } from "./types.js";
import type { MeetingTranscriptTurn, MeetingNoteAttendee } from "@brett/types";
import { prisma } from "../../lib/prisma.js";
import { withGranolaClient, type GranolaTools } from "../../lib/granola-mcp.js";
import { findBestMatch, type MatchCandidate } from "../meeting-matcher.js";

export class GranolaProvider implements MeetingNoteProvider {
  readonly provider = "granola";

  async isAvailable(userId: string): Promise<boolean> {
    const account = await prisma.granolaAccount.findUnique({
      where: { userId },
      select: { id: true },
    });
    return !!account;
  }

  async fetchForEvent(
    userId: string,
    calendarEvent: CalendarEvent,
  ): Promise<ProviderMeetingData | null> {
    const account = await prisma.granolaAccount.findUnique({
      where: { userId },
    });
    if (!account) return null;

    // Build a search window: 15min before to 30min after the calendar event
    const windowStart = new Date(calendarEvent.startTime.getTime() - 15 * 60 * 1000);
    const windowEnd = new Date(calendarEvent.endTime.getTime() + 30 * 60 * 1000);

    return withGranolaClient(account.id, async (tools) => {
      const meetings = await tools.listMeetings(
        "custom",
        windowStart.toISOString(),
        windowEnd.toISOString(),
      );

      if (meetings.length === 0) return null;

      // Build MatchCandidates from calendar event for matching against granola meetings
      const calendarCandidate: MatchCandidate = {
        id: calendarEvent.id,
        title: calendarEvent.title,
        startTime: calendarEvent.startTime,
        endTime: calendarEvent.endTime,
        attendees: extractCalendarAttendeeEmails(calendarEvent),
      };

      // Find the best Granola meeting that matches this calendar event
      // We treat each Granola meeting as the "input" and the calendar event as the candidate
      let bestMeeting: { id: string; score: number } | null = null;
      for (const meeting of meetings) {
        const result = findBestMatch(
          {
            title: meeting.title,
            startTime: new Date(meeting.start_time),
            endTime: new Date(meeting.end_time),
            attendees: (meeting.attendees ?? []).map((a) => ({ email: a.email })),
          },
          [calendarCandidate],
        );
        if (result && (!bestMeeting || result.score > bestMeeting.score)) {
          bestMeeting = { id: meeting.id, score: result.score };
        }
      }

      if (!bestMeeting) return null;

      const matchedListItem = meetings.find((m) => m.id === bestMeeting!.id)!;
      return fetchMeetingData(tools, matchedListItem, account.id, calendarEvent.id);
    });
  }

  async fetchRecent(
    userId: string,
    since: Date,
    until: Date,
  ): Promise<ProviderMeetingData[]> {
    const account = await prisma.granolaAccount.findUnique({
      where: { userId },
    });
    if (!account) return [];

    return withGranolaClient(account.id, async (tools) => {
      const meetings = await tools.listMeetings(
        "custom",
        since.toISOString(),
        until.toISOString(),
      );

      if (meetings.length === 0) return [];

      const results: ProviderMeetingData[] = [];
      for (const meeting of meetings) {
        const data = await fetchMeetingData(tools, meeting, account.id);
        results.push(data);
      }
      return results;
    });
  }
}

// ── Helpers ──

interface GranolaMeetingListItem {
  id: string;
  title: string;
  start_time: string;
  end_time: string;
  attendees?: { name: string; email: string }[];
}

async function fetchMeetingData(
  tools: GranolaTools,
  listItem: GranolaMeetingListItem,
  accountId: string,
  calendarEventId?: string,
): Promise<ProviderMeetingData> {
  // Fetch details and transcript in parallel
  const [details, transcript] = await Promise.all([
    tools.getMeetings([listItem.id]),
    tools.getTranscript(listItem.id),
  ]);

  const detail = details[0];

  // Map transcript turns to the shared type
  const mappedTranscript: MeetingTranscriptTurn[] | null = transcript
    ? transcript.turns.map((t) => ({
        source: t.source === "microphone" ? ("microphone" as const) : ("speaker" as const),
        speaker: t.speaker,
        text: t.text,
      }))
    : null;

  // Use detail attendees if available, fall back to list item attendees
  const rawAttendees = detail?.attendees ?? listItem.attendees ?? [];
  const attendees: MeetingNoteAttendee[] = rawAttendees.map((a) => ({
    name: a.name,
    email: a.email,
  }));

  return {
    provider: "granola",
    externalId: listItem.id,
    accountId,
    calendarEventId,
    title: detail?.title ?? listItem.title,
    summary: detail?.summary ?? detail?.notes ?? null,
    transcript: mappedTranscript,
    attendees: attendees.length > 0 ? attendees : null,
    meetingStartedAt: new Date(detail?.start_time ?? listItem.start_time),
    meetingEndedAt: new Date(detail?.end_time ?? listItem.end_time),
    rawData: { listItem, detail: detail ?? null, transcript },
  };
}

/**
 * Extract attendee emails from a CalendarEvent's JSON attendees field.
 * The field is Prisma Json? — typed as unknown at runtime.
 */
function extractCalendarAttendeeEmails(
  event: CalendarEvent,
): { email: string }[] {
  const attendees = event.attendees as unknown;
  if (!Array.isArray(attendees)) return [];
  return attendees
    .filter((a) => a != null && typeof a === "object" && typeof a.email === "string")
    .map((a) => ({ email: (a as { email: string }).email }));
}
