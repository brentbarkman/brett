import { prisma } from "../lib/prisma.js";
import {
  listGranolaMeetings,
  getGranolaMeetings,
  getGranolaTranscript,
} from "../lib/granola-mcp.js";
import { findBestMatch, type MatchCandidate } from "./meeting-matcher.js";
import { publishSSE } from "../lib/sse.js";
import { validateCreateItem } from "@brett/business";

// Working hours gate: 8am-7pm in user's timezone
const WORKING_HOURS_START = 8;
const WORKING_HOURS_END = 19;

function isWithinWorkingHours(timezone: string): boolean {
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
    await syncMeetings(account.id, userId, meetings);

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
    const meetings = await listGranolaMeetings(account.id, "custom",
      new Date(new Date().setHours(0, 0, 0, 0)).toISOString(),
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
): Promise<number> {
  if (meetingList.length === 0) return 0;

  // Filter to only new meetings we haven't synced
  const existingIds = await prisma.granolaMeeting.findMany({
    where: {
      granolaDocumentId: { in: meetingList.map((m) => m.id) },
      userId,
    },
    select: { granolaDocumentId: true },
  });
  const existingSet = new Set(existingIds.map((e) => e.granolaDocumentId));
  const newMeetings = meetingList.filter((m) => !existingSet.has(m.id));

  if (newMeetings.length === 0) return 0;

  // Fetch full details for new meetings
  const details = await getGranolaMeetings(
    granolaAccountId,
    newMeetings.map((m) => m.id),
  );

  // Load calendar events for matching (same day window)
  const earliest = new Date(
    Math.min(...newMeetings.map((m) => new Date(m.start_time).getTime())),
  );
  const latest = new Date(
    Math.max(...newMeetings.map((m) => new Date(m.end_time).getTime())),
  );
  const calendarEvents = await prisma.calendarEvent.findMany({
    where: {
      userId,
      startTime: { gte: new Date(earliest.getTime() - 60 * 60 * 1000) },
      endTime: { lte: new Date(latest.getTime() + 60 * 60 * 1000) },
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

  for (const detail of details) {
    try {
      // Fetch transcript
      let transcript = null;
      try {
        transcript = await getGranolaTranscript(granolaAccountId, detail.id);
      } catch {
        console.warn(`[granola-sync] Failed to fetch transcript for ${detail.id}`);
      }

      // Match to calendar event
      const meetingAttendees = detail.attendees?.map((a) => ({ email: a.email })) ?? [];
      const match = findBestMatch(
        {
          title: detail.title,
          startTime: new Date(detail.start_time),
          endTime: new Date(detail.end_time),
          attendees: meetingAttendees,
        },
        candidates,
      );

      // Store meeting
      const meeting = await prisma.granolaMeeting.create({
        data: {
          granolaDocumentId: detail.id,
          userId,
          granolaAccountId,
          calendarEventId: match?.id ?? null,
          title: detail.title,
          summary: detail.summary ?? detail.notes ?? null,
          transcript: transcript?.turns ?? undefined,
          attendees: detail.attendees ?? undefined,
          meetingStartedAt: new Date(detail.start_time),
          meetingEndedAt: new Date(detail.end_time),
          rawData: detail as any,
        },
      });

      // Extract and create action items
      await extractAndCreateActionItems(meeting.id, userId, detail.summary ?? detail.notes ?? "");

      syncedCount++;
    } catch (err) {
      console.error(`[granola-sync] Failed to sync meeting ${detail.id}:`, err);
    }
  }

  return syncedCount;
}

/**
 * Extract action items from meeting summary, then create them as tasks.
 * Uses simple pattern-based extraction for v1.
 */
async function extractAndCreateActionItems(
  granolaMeetingId: string,
  userId: string,
  summaryText: string,
): Promise<void> {
  if (!summaryText.trim()) return;

  // Simple pattern-based extraction for v1
  const actionItemPatterns = [
    /^[-*\u2022]\s*(?:action item|todo|task|follow[- ]?up):\s*(.+)/gim,
    /^[-*\u2022]\s*\[[ x]?\]\s*(.+)/gim,  // Checkbox items
    /^(?:action item|todo|task|follow[- ]?up):\s*(.+)/gim,
  ];

  const items: { title: string }[] = [];
  for (const pattern of actionItemPatterns) {
    let match;
    while ((match = pattern.exec(summaryText)) !== null) {
      const title = match[1].trim();
      if (title.length > 3 && title.length < 200) {
        items.push({ title });
      }
    }
  }

  // Deduplicate by title
  const seen = new Set<string>();
  const unique = items.filter((item) => {
    const key = item.title.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Store extracted items on the meeting record
  if (unique.length > 0) {
    await prisma.granolaMeeting.update({
      where: { id: granolaMeetingId },
      data: { actionItems: unique },
    });
  }

  // Create tasks for each action item
  for (const actionItem of unique) {
    const validation = validateCreateItem({
      type: "task",
      title: actionItem.title,
      source: "Granola",
    });

    if (!validation.ok) continue;

    await prisma.item.create({
      data: {
        type: "task",
        title: validation.data.title,
        source: "Granola",
        status: "active",
        userId,
        granolaMeetingId,
      },
    });
  }

  if (unique.length > 0) {
    publishSSE(userId, {
      type: "granola.action_items.created",
      payload: { count: unique.length, granolaMeetingId },
    });
  }
}
