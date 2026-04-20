import { prisma } from "../lib/prisma.js";
import {
  listGranolaMeetings,
  withGranolaClient,
} from "../lib/granola-mcp.js";
import { findBestMatch, type MatchCandidate } from "./meeting-matcher.js";
import { publishSSE } from "../lib/sse.js";
import { processActionItems } from "./granola-action-items.js";
import { createRelinkTask } from "../lib/connection-health.js";
import { enqueueEmbed } from "@brett/ai";

function isAuthError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes("Token refresh failed") || /^(401|403)\b/.test(msg);
}

// Working hours gate: 8am-7pm in user's timezone
const WORKING_HOURS_START = 8;
const WORKING_HOURS_END = 19;

/** Compute start-of-day in the user's timezone, returned as a UTC Date. */
function startOfDayInTimezone(timezone: string): Date {
  try {
    const now = new Date();
    // en-CA gives YYYY-MM-DD format
    const dateStr = now.toLocaleDateString("en-CA", { timeZone: timezone });
    return new Date(dateStr + "T00:00:00");
  } catch {
    // Fallback: server-local start of day
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }
}

const CANDIDATE_WINDOW_PAD_MS = 24 * 60 * 60 * 1000;

/**
 * Compute the time range for fetching CalendarEvent candidates to match
 * against a batch of Granola meetings. Padded by a full day on each side
 * because Granola's `start_time` does not reliably line up with the
 * Google Calendar event (observed offsets of 4-7h in production). Uses
 * `start_time` only — Granola returns `end_time === start_time` for
 * every row, so relying on end_time would collapse the upper bound.
 */
export function calendarCandidateWindow(
  meetings: { start_time: string }[],
): { gte: Date; lte: Date } {
  const starts = meetings.map((m) => new Date(m.start_time).getTime());
  const earliest = Math.min(...starts);
  const latest = Math.max(...starts);
  return {
    gte: new Date(earliest - CANDIDATE_WINDOW_PAD_MS),
    lte: new Date(latest + CANDIDATE_WINDOW_PAD_MS),
  };
}

const DEFAULT_MEETING_DURATION_MS = 30 * 60 * 1000;

/**
 * Resolve the authoritative start/end times for a synced Granola meeting.
 * Granola's payload only carries a single human-readable `date` — no end
 * time, no duration, no timezone indicator. The linked Google Calendar
 * event is the source of truth when available; otherwise fall back to
 * Granola's start + 30 min so durations aren't zero-width.
 */
export function resolveMeetingTimes(
  granolaStart: Date,
  matched: { startTime: Date; endTime: Date } | null,
): { startedAt: Date; endedAt: Date } {
  if (matched) {
    return { startedAt: matched.startTime, endedAt: matched.endTime };
  }
  return {
    startedAt: granolaStart,
    endedAt: new Date(granolaStart.getTime() + DEFAULT_MEETING_DURATION_MS),
  };
}

export function isWithinWorkingHours(timezone: string): boolean {
  try {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      hour12: false,
    });
    const hour = parseInt(formatter.format(now), 10);
    return hour >= WORKING_HOURS_START && hour < WORKING_HOURS_END;
  } catch {
    // Fallback: assume working hours
    return true;
  }
}

/**
 * Initial sync after connecting Granola — fetch last 30 days of meetings.
 */
export async function initialGranolaSync(userId: string): Promise<void> {
  const account = await prisma.granolaAccount.findUnique({
    where: { userId },
  });
  if (!account) return;

  console.log(`[granola-sync] Initial sync for user ${userId}`);

  try {
    const meetings = await listGranolaMeetings(account.id, "last_30_days");
    await syncMeetings(account.id, userId, meetings, { extractActions: false });

    await prisma.granolaAccount.update({
      where: { id: account.id },
      data: { lastSyncAt: new Date() },
    });

    publishSSE(userId, {
      type: "granola.meeting.synced",
      payload: { count: meetings.length },
    });
  } catch (err) {
    console.error(`[granola-sync] Initial sync failed for user ${userId}:`, err);
    if (isAuthError(err)) {
      await createRelinkTask(
        userId, "granola", account.id,
        "Granola sync failed — your connection was lost or the token expired. Go to Settings → Granola to reconnect.",
      ).catch((e) => console.error("[granola-sync] Failed to create re-link task:", e));
    }
  }
}

/**
 * Incremental sync — fetch meetings since last sync.
 * Called by cron (periodic sweep) and calendar-event-driven trigger.
 */
export async function incrementalGranolaSync(userId: string): Promise<void> {
  const account = await prisma.granolaAccount.findUnique({
    where: { userId },
    include: { user: { select: { timezone: true } } },
  });
  if (!account) return;

  // Working hours gate
  if (!isWithinWorkingHours(account.user.timezone)) return;

  try {
    // Fetch today's meetings (catches new ones since last sync)
    const todayStart = startOfDayInTimezone(account.user.timezone);
    const meetings = await listGranolaMeetings(account.id, "custom",
      todayStart.toISOString(),
      new Date().toISOString(),
    );
    const newCount = await syncMeetings(account.id, userId, meetings);

    await prisma.granolaAccount.update({
      where: { id: account.id },
      data: { lastSyncAt: new Date() },
    });

    if (newCount > 0) {
      publishSSE(userId, {
        type: "granola.meeting.synced",
        payload: { count: newCount },
      });
    }
  } catch (err) {
    console.error(`[granola-sync] Incremental sync failed for user ${userId}:`, err);
    if (isAuthError(err)) {
      await createRelinkTask(
        userId, "granola", account.id,
        "Granola sync failed — your connection was lost or the token expired. Go to Settings → Granola to reconnect.",
      ).catch((e) => console.error("[granola-sync] Failed to create re-link task:", e));
    }
  }
}

/**
 * Calendar-event-driven sync — called ~5 min after a calendar event ends.
 * Fetches Granola meetings in a narrow time window around the event.
 */
export async function syncAfterMeeting(
  userId: string,
  eventStartTime: Date,
  eventEndTime: Date,
): Promise<void> {
  const account = await prisma.granolaAccount.findUnique({
    where: { userId },
  });
  if (!account) return;

  try {
    // Fetch meetings in a window around the event
    const start = new Date(eventStartTime.getTime() - 15 * 60 * 1000); // 15 min before
    const end = new Date(eventEndTime.getTime() + 30 * 60 * 1000);     // 30 min after
    const meetings = await listGranolaMeetings(
      account.id, "custom",
      start.toISOString(),
      end.toISOString(),
    );
    await syncMeetings(account.id, userId, meetings);
  } catch (err) {
    console.error(`[granola-sync] Post-meeting sync failed for user ${userId}:`, err);
    if (isAuthError(err)) {
      await createRelinkTask(
        userId, "granola", account.id,
        "Granola sync failed — your connection was lost or the token expired. Go to Settings → Granola to reconnect.",
      ).catch((e) => console.error("[granola-sync] Failed to create re-link task:", e));
    }
  }
}

/**
 * Core sync logic: for each meeting from Granola, fetch details, match to
 * calendar events, extract action items, and store.
 * Returns count of newly synced meetings.
 */
async function syncMeetings(
  granolaAccountId: string,
  userId: string,
  meetingList: { id: string; title: string; start_time: string; end_time: string; attendees?: { name: string; email: string }[] }[],
  options: { extractActions: boolean } = { extractActions: true },
): Promise<number> {
  if (meetingList.length === 0) return 0;

  // Filter to only new meetings we haven't synced
  const existingIds = await prisma.meetingNote.findMany({
    where: {
      granolaDocumentId: { in: meetingList.map((m) => m.id) },
      userId,
    },
    select: { granolaDocumentId: true },
  });
  const existingSet = new Set(existingIds.map((e) => e.granolaDocumentId));
  const newMeetings = meetingList.filter((m) => !existingSet.has(m.id));

  if (newMeetings.length === 0) return 0;

  // Fetch details + transcripts using a single MCP client connection.
  // Use list metadata (title, time, attendees) as primary source since
  // getMeetings returns notes/summary but list_meetings has the metadata.
  const detailMap = await withGranolaClient(granolaAccountId, async (tools) => {
    const meetingDetails = await tools.getMeetings(newMeetings.map((m) => m.id));
    const detailById = new Map(meetingDetails.map((d) => [d.id, d]));

    const transcripts = new Map<string, { turns: { source: string; speaker: string; text: string }[] } | null>();
    for (const m of newMeetings) {
      try {
        transcripts.set(m.id, await tools.getTranscript(m.id));
      } catch {
        console.warn(`[granola-sync] Failed to fetch transcript for ${m.id}`);
        transcripts.set(m.id, null);
      }
    }

    return { detailById, transcripts };
  });

  // Load calendar events for matching.
  // Granola's reported times do not reliably align with Google Calendar's
  // startTime (observed offsets of 4-7h in prod, and end_time === start_time
  // on every row). The window must be padded generously so the real calendar
  // event still falls inside it.
  const { gte, lte } = calendarCandidateWindow(newMeetings);
  const calendarEvents = await prisma.calendarEvent.findMany({
    where: {
      userId,
      startTime: { gte, lte },
    },
    select: {
      id: true,
      title: true,
      startTime: true,
      endTime: true,
      attendees: true,
    },
  });

  // Build match candidates
  const candidates: MatchCandidate[] = calendarEvents.map((e) => ({
    id: e.id,
    title: e.title,
    startTime: e.startTime,
    endTime: e.endTime,
    attendees: Array.isArray(e.attendees)
      ? (e.attendees as { email: string }[])
      : [],
  }));

  let syncedCount = 0;

  // Use list metadata as primary source, merge with detail notes
  for (const listItem of newMeetings) {
    try {
      const detail = detailMap.detailById.get(listItem.id);
      const transcript = detailMap.transcripts.get(listItem.id) ?? null;

      // Match to calendar event using list metadata (reliable title + time + attendees)
      const meetingAttendees = listItem.attendees?.map((a) => ({ email: a.email })) ?? [];
      const match = findBestMatch(
        {
          title: listItem.title,
          startTime: new Date(listItem.start_time),
          endTime: new Date(listItem.end_time),
          attendees: meetingAttendees,
        },
        candidates,
      );

      // Use list metadata for title/attendees, detail for notes/summary.
      // Times come from the matched calendar event (UTC-correct, real
      // duration) when available — Granola's payload carries only a
      // single naive local-time string, so we can't trust it.
      const summary = detail?.summary ?? detail?.notes ?? null;
      const matchedCandidate = match
        ? candidates.find((c) => c.id === match.id) ?? null
        : null;
      const calendarEventId = match?.id ?? null;
      const times = resolveMeetingTimes(
        new Date(listItem.start_time),
        matchedCandidate,
      );

      // Create meeting record (action items processed separately to avoid long transactions)
      const meeting = await prisma.meetingNote.create({
        data: {
          granolaDocumentId: listItem.id,
          userId,
          granolaAccountId,
          calendarEventId,
          title: listItem.title,
          summary,
          transcript: transcript?.turns ?? undefined,
          attendees: listItem.attendees ?? undefined,
          meetingStartedAt: times.startedAt,
          meetingEndedAt: times.endedAt,
          rawData: (detail as any) ?? undefined,
        },
      });

      // Enqueue embedding for newly synced meeting note
      enqueueEmbed({ entityType: "meeting_note", entityId: meeting.id, userId });

      // Extract action items outside the transaction (AI calls can be slow)
      if (options.extractActions && summary) {
        try {
          await processActionItems(
            meeting.id,
            calendarEventId,
            userId,
            summary,
            listItem.title,
            new Date(listItem.start_time),
            listItem.attendees ?? [],
          );
        } catch (actionErr) {
          console.error(`[granola-sync] Action item extraction failed for ${listItem.id}:`, actionErr);
        }
      }

      syncedCount++;
    } catch (err: any) {
      // P2002 = unique constraint violation on granolaDocumentId — already synced by concurrent job
      if (err?.code === "P2002") {
        continue;
      }
      console.error(`[granola-sync] Failed to sync meeting ${listItem.id}:`, err);
    }
  }

  return syncedCount;
}

