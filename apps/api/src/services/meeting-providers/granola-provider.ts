import type { CalendarEvent } from "@brett/api-core";
import type { MeetingNoteProvider, ProviderMeetingData } from "./types.js";
import type { MeetingTranscriptTurn, MeetingNoteAttendee } from "@brett/types";
import { prisma } from "../../lib/prisma.js";
import { withGranolaClient, type GranolaTools } from "../../lib/granola-mcp.js";
import { findBestMatch, type MatchCandidate } from "../meeting-matcher.js";
import { createRelinkTask } from "../../lib/connection-health.js";

function isAuthError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes("Token refresh failed") || /^(401|403)\b/.test(msg);
}

const RELINK_MESSAGE =
  "Granola sync failed — your connection was lost or the token expired. Go to Settings → Granola to reconnect.";

async function handleAccountError(userId: string, accountId: string, err: unknown): Promise<void> {
  console.error(`[granola-provider] Account ${accountId} sync failed:`, err);
  if (isAuthError(err)) {
    await createRelinkTask(userId, "granola", accountId, RELINK_MESSAGE).catch((e) =>
      console.error("[granola-provider] Failed to create re-link task:", e),
    );
  }
}

export class GranolaProvider implements MeetingNoteProvider {
  readonly provider = "granola";

  async isAvailable(userId: string): Promise<boolean> {
    const account = await prisma.granolaAccount.findFirst({
      where: { userId },
      select: { id: true },
    });
    return !!account;
  }

  async fetchForEvent(
    userId: string,
    calendarEvent: CalendarEvent,
  ): Promise<ProviderMeetingData | null> {
    const accounts = await prisma.granolaAccount.findMany({ where: { userId } });
    if (accounts.length === 0) return null;

    const windowStart = new Date(calendarEvent.startTime.getTime() - 15 * 60 * 1000);
    const windowEnd = new Date(calendarEvent.endTime.getTime() + 30 * 60 * 1000);

    const calendarCandidate: MatchCandidate = {
      id: calendarEvent.id,
      title: calendarEvent.title,
      startTime: calendarEvent.startTime,
      endTime: calendarEvent.endTime,
      attendees: extractCalendarAttendeeEmails(calendarEvent),
    };

    // Collect best-match from each account, pick the highest score across accounts.
    // Per-account auth failure logs + creates a re-link task scoped to that
    // accountId and continues with remaining accounts.
    let best: {
      accountId: string;
      listItem: GranolaMeetingListItem;
      score: number;
    } | null = null;

    for (const account of accounts) {
      try {
        const result = await withGranolaClient(account.id, async (tools) => {
          const meetings = await tools.listMeetings(
            "custom",
            windowStart.toISOString(),
            windowEnd.toISOString(),
          );
          if (meetings.length === 0) return null;

          let bestForAccount: { listItem: GranolaMeetingListItem; score: number } | null = null;
          for (const meeting of meetings) {
            const match = findBestMatch(
              {
                title: meeting.title,
                startTime: new Date(meeting.start_time),
                endTime: new Date(meeting.end_time),
                attendees: (meeting.attendees ?? []).map((a) => ({ email: a.email })),
              },
              [calendarCandidate],
            );
            if (match && (!bestForAccount || match.score > bestForAccount.score)) {
              bestForAccount = { listItem: meeting, score: match.score };
            }
          }
          return bestForAccount;
        });

        if (result && (!best || result.score > best.score)) {
          best = { accountId: account.id, ...result };
        }
      } catch (err) {
        await handleAccountError(userId, account.id, err);
      }
    }

    if (!best) return null;

    try {
      return await withGranolaClient(best.accountId, (tools) =>
        fetchMeetingData(tools, best!.listItem, best!.accountId, calendarEvent.id),
      );
    } catch (err) {
      await handleAccountError(userId, best.accountId, err);
      return null;
    }
  }

  async fetchRecent(
    userId: string,
    since: Date,
    until: Date,
  ): Promise<ProviderMeetingData[]> {
    const accounts = await prisma.granolaAccount.findMany({ where: { userId } });
    if (accounts.length === 0) return [];

    const all: ProviderMeetingData[] = [];

    for (const account of accounts) {
      try {
        const accountResults = await withGranolaClient(account.id, async (tools) => {
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
        all.push(...accountResults);
      } catch (err) {
        await handleAccountError(userId, account.id, err);
      }
    }

    return all;
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
  const [details, transcript] = await Promise.all([
    tools.getMeetings([listItem.id]),
    tools.getTranscript(listItem.id),
  ]);

  const detail = details[0];

  const mappedTranscript: MeetingTranscriptTurn[] | null = transcript
    ? transcript.turns.map((t) => ({
        source: t.source === "microphone" ? ("microphone" as const) : ("speaker" as const),
        speaker: t.speaker,
        text: t.text,
      }))
    : null;

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

function extractCalendarAttendeeEmails(
  event: CalendarEvent,
): { email: string }[] {
  const attendees = event.attendees as unknown;
  if (!Array.isArray(attendees)) return [];
  return attendees
    .filter((a) => a != null && typeof a === "object" && typeof a.email === "string")
    .map((a) => ({ email: (a as { email: string }).email }));
}
