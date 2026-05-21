import type { CalendarEvent } from "@brett/api-core";
import type { MeetingNoteProvider, ProviderMeetingData } from "./types.js";
import type { MeetingTranscriptTurn, MeetingNoteAttendee } from "@brett/types";
import { prisma } from "../../lib/prisma.js";
import { withGranolaClient, type GranolaTools } from "../../lib/granola-mcp.js";
import { findBestMatch, type MatchCandidate } from "../meeting-matcher.js";
import { createRelinkTask } from "../../lib/connection-health.js";

function isAuthError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  // Explicit refresh failure thrown by granola-mcp.ts on a refresh non-2xx.
  if (msg.includes("Token refresh failed")) return true;
  // Match 401 or 403 anywhere with word boundaries. The MCP SDK wraps HTTP
  // errors in varying envelopes ("HTTP error 401", "401 Unauthorized",
  // "Server responded with status 403"); a contains-match is safer than the
  // original ^anchor at the cost of an occasional false positive (which
  // resolves on next successful sync).
  return /\b(401|403)\b/.test(msg);
}

/**
 * Best-effort write that records the moment we successfully completed a
 * round of Granola calls for this account. The Settings UI uses this for
 * the "Last sync" display — a stale value signals an unhealthy connection.
 *
 * Failures are logged but never thrown: the sync itself already succeeded,
 * and dropping its data on the floor because we couldn't update a timestamp
 * would be worse than a slightly stale UI.
 */
async function markAccountSynced(accountId: string): Promise<void> {
  await prisma.granolaAccount
    .update({
      where: { id: accountId },
      data: { lastSyncAt: new Date() },
    })
    .catch((err) =>
      console.error(
        `[granola-provider] Failed to bump lastSyncAt for account ${accountId}:`,
        err,
      ),
    );
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

    // For each account, list candidate meetings, find the best match against
    // the calendar event, and (if matched) fetch full details — all inside a
    // single client scope so a token-refresh boundary doesn't fall between
    // the list call and the detail call. Then pick the highest-scoring
    // ProviderMeetingData across all accounts. Per-account auth failure
    // creates a re-link task scoped to that accountId and continues.
    let best: { score: number; data: ProviderMeetingData } | null = null;

    for (const account of accounts) {
      try {
        const result = await withGranolaClient(account.id, userId, async (tools) => {
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
          if (!bestForAccount) return null;

          // Same-client-scope detail fetch — avoids a second connect/refresh
          // round-trip and prevents the token-expiry-between-calls race.
          const data = await fetchMeetingData(
            tools,
            bestForAccount.listItem,
            account.id,
            calendarEvent.id,
          );
          return { score: bestForAccount.score, data };
        });

        // Reached here = withGranolaClient resolved (auth, refresh, and the
        // closure's Granola calls all succeeded). Bump lastSyncAt even when
        // result is null — we successfully checked, there just wasn't a match.
        await markAccountSynced(account.id);

        if (result && (!best || result.score > best.score)) {
          best = result;
        }
      } catch (err) {
        await handleAccountError(userId, account.id, err);
      }
    }

    return best?.data ?? null;
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
        const accountResults = await withGranolaClient(account.id, userId, async (tools) => {
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

        // Reached here = the Granola round-trip succeeded for this account.
        // Bump lastSyncAt even when accountResults is empty — the connection
        // is healthy, there's just nothing new in this window.
        await markAccountSynced(account.id);

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
