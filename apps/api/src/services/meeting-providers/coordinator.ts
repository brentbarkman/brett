import type { CalendarEvent } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { publishSSE } from "../../lib/sse.js";
import { enqueueEmbed } from "@brett/ai";
import { processActionItems } from "../granola-action-items.js";
import { mergeMeetingNoteFields, type MergeInput } from "./merge.js";
import { scrubProviderRawData } from "./scrub.js";
import type { ProviderMeetingData } from "./types.js";
import type { MeetingTranscriptTurn, MeetingNoteAttendee } from "@brett/types";
import { providerRegistry } from "./registry.js";

const log = (...args: unknown[]) => console.log("[meeting-coordinator]", ...args);

/** Cast an array/object to Prisma's InputJsonValue, or DbNull if null. */
function jsonOrNull(value: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull {
  if (value == null) return Prisma.DbNull;
  return value as Prisma.InputJsonValue;
}

// ── Public API ──

/**
 * Sync meeting notes for a single calendar event.
 * Called by the post-meeting cron per event.
 */
export async function syncForEvent(
  userId: string,
  calendarEvent: CalendarEvent,
): Promise<void> {
  const providers = await providerRegistry.getAvailable(userId);
  if (providers.length === 0) return;

  // Fetch from all providers in parallel
  const results = await Promise.allSettled(
    providers.map((p) => p.fetchForEvent(userId, calendarEvent)),
  );

  // Merge sequentially to prevent race conditions on the same MeetingNote
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === "rejected") {
      log(`Provider ${providers[i].provider} failed for event ${calendarEvent.id}:`, result.reason);
      continue;
    }
    const data = result.value;
    if (!data) continue;

    const calendarEventId = data.calendarEventId ?? calendarEvent.id;
    await mergeProviderData(userId, calendarEventId, data);
  }
}

/**
 * Sync recent meeting notes across all providers.
 * Called by the periodic sweep cron.
 */
export async function syncRecent(
  userId: string,
  since: Date,
  until: Date,
): Promise<void> {
  const providers = await providerRegistry.getAvailable(userId);
  if (providers.length === 0) return;

  // Fetch from all providers in parallel
  const results = await Promise.allSettled(
    providers.map((p) => p.fetchRecent(userId, since, until)),
  );

  // Collect all provider data, then merge sequentially
  const allData: ProviderMeetingData[] = [];
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === "rejected") {
      log(`Provider ${providers[i].provider} fetchRecent failed:`, result.reason);
      continue;
    }
    allData.push(...result.value);
  }

  for (const data of allData) {
    const calendarEventId = data.calendarEventId ?? (await findCalendarEventId(userId, data));
    if (!calendarEventId) {
      log(`No calendar event match for "${data.title}" from ${data.provider}, skipping`);
      continue;
    }
    await mergeProviderData(userId, calendarEventId, data);
  }
}

/**
 * Initial sync for a newly connected provider.
 * Fetches recent data (last 14 days) from a single provider.
 */
export async function initialSync(
  userId: string,
  providerName: string,
): Promise<void> {
  const providers = providerRegistry.getAll();
  const provider = providers.find((p) => p.provider === providerName);
  if (!provider) {
    log(`Provider "${providerName}" not registered`);
    return;
  }

  const available = await provider.isAvailable(userId);
  if (!available) {
    log(`Provider "${providerName}" not available for user ${userId}`);
    return;
  }

  const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
  const until = new Date();
  const data = await provider.fetchRecent(userId, since, until);

  for (const item of data) {
    const calendarEventId = item.calendarEventId ?? (await findCalendarEventId(userId, item));
    if (!calendarEventId) {
      log(`No calendar event match for "${item.title}" from ${item.provider}, skipping`);
      continue;
    }
    await mergeProviderData(userId, calendarEventId, item);
  }
}

// ── Private ──

/**
 * Fuzzy-match a provider meeting to a calendar event when no calendarEventId is present.
 */
async function findCalendarEventId(
  userId: string,
  data: ProviderMeetingData,
): Promise<string | null> {
  const { findBestMatch } = await import("../meeting-matcher.js");

  // Find candidate calendar events within a window around the meeting time
  const windowMs = 4 * 60 * 60 * 1000; // 4 hours
  const candidates = await prisma.calendarEvent.findMany({
    where: {
      userId,
      startTime: {
        gte: new Date(data.meetingStartedAt.getTime() - windowMs),
        lte: new Date(data.meetingStartedAt.getTime() + windowMs),
      },
    },
    select: {
      id: true,
      title: true,
      startTime: true,
      endTime: true,
      attendees: true,
    },
  });

  const matchCandidates = candidates.map((c) => ({
    id: c.id,
    title: c.title,
    startTime: c.startTime,
    endTime: c.endTime,
    attendees: Array.isArray(c.attendees)
      ? (c.attendees as { email: string }[])
      : [],
  }));

  const match = findBestMatch(
    {
      title: data.title,
      startTime: data.meetingStartedAt,
      endTime: data.meetingEndedAt,
      attendees: data.attendees?.map((a) => ({ email: a.email })) ?? [],
    },
    matchCandidates,
  );

  return match?.id ?? null;
}

/**
 * Core merge logic: upsert MeetingNote, create MeetingNoteSource, embed, extract action items.
 */
async function mergeProviderData(
  userId: string,
  calendarEventId: string,
  data: ProviderMeetingData,
): Promise<void> {
  try {
    // Check if this source already exists (idempotency)
    const existingSource = await prisma.meetingNoteSource.findUnique({
      where: { provider_externalId: { provider: data.provider, externalId: data.externalId } },
    });
    if (existingSource) {
      log(`Source ${data.provider}:${data.externalId} already exists, skipping`);
      return;
    }

    // Load existing MeetingNote if any
    const existing = await prisma.meetingNote.findUnique({
      where: { userId_calendarEventId: { userId, calendarEventId } },
    });

    const isFirstSource = !existing;

    // Build merge input from existing note (or empty)
    const existingInput: MergeInput = existing
      ? {
          title: existing.title,
          summary: existing.summary,
          transcript: existing.transcript as MeetingTranscriptTurn[] | null,
          attendees: existing.attendees as MeetingNoteAttendee[] | null,
          sources: existing.sources,
        }
      : {
          title: null,
          summary: null,
          transcript: null,
          attendees: null,
          sources: [],
        };

    // Merge fields
    const merged = mergeMeetingNoteFields(existingInput, {
      provider: data.provider,
      title: data.title,
      summary: data.summary,
      transcript: data.transcript,
      attendees: data.attendees,
    });

    // Scrub raw data before storage
    const scrubbedRawData = scrubProviderRawData(data.provider, data.rawData);

    // Account FK based on provider
    const accountFks = data.provider === "granola"
      ? { granolaAccountId: data.accountId }
      : data.provider === "google_meet"
        ? { googleAccountId: data.accountId }
        : {};

    // Upsert MeetingNote + create MeetingNoteSource in a transaction
    const meetingNote = await prisma.$transaction(async (tx) => {
      const note = await tx.meetingNote.upsert({
        where: { userId_calendarEventId: { userId, calendarEventId } },
        create: {
          userId,
          calendarEventId,
          provider: data.provider,
          title: merged.title,
          summary: merged.summary,
          transcript: jsonOrNull(merged.transcript),
          attendees: jsonOrNull(merged.attendees),
          meetingStartedAt: data.meetingStartedAt,
          meetingEndedAt: data.meetingEndedAt,
          rawData: jsonOrNull(scrubbedRawData),
          sources: merged.sources,
          syncedAt: new Date(),
          ...accountFks,
        },
        update: {
          title: merged.title,
          summary: merged.summary,
          transcript: jsonOrNull(merged.transcript),
          attendees: jsonOrNull(merged.attendees),
          sources: merged.sources,
          rawData: jsonOrNull(scrubbedRawData),
          syncedAt: new Date(),
        },
      });

      // Create source record
      await tx.meetingNoteSource.create({
        data: {
          meetingNoteId: note.id,
          userId,
          provider: data.provider,
          externalId: data.externalId,
          title: data.title,
          summary: data.summary,
          transcript: jsonOrNull(data.transcript),
          attendees: jsonOrNull(data.attendees),
          rawData: jsonOrNull(scrubbedRawData),
          ...accountFks,
        },
      });

      return note;
    });

    log(`Merged ${data.provider} into MeetingNote ${meetingNote.id} (first=${isFirstSource})`);

    // Embed (always — content may have changed with new source)
    enqueueEmbed({
      entityType: "meeting_note",
      entityId: meetingNote.id,
      userId,
    });

    // Action items only on first source (avoid duplicates)
    if (isFirstSource && merged.summary) {
      processActionItems(
        meetingNote.id,
        calendarEventId,
        userId,
        merged.summary,
        merged.title,
        data.meetingStartedAt,
        (merged.attendees ?? []) as { name: string; email: string }[],
      ).catch((err) => log(`Action item extraction failed for ${meetingNote.id}:`, err));
    }

    // Notify client
    publishSSE(userId, {
      type: "meeting.note.synced",
      payload: {
        meetingNoteId: meetingNote.id,
        calendarEventId,
        provider: data.provider,
        isFirstSource,
      },
    });
  } catch (err) {
    // P2002 = unique constraint violation (concurrent sync)
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      log(`Concurrent sync collision for ${data.provider}:${data.externalId}, safe to ignore`);
      return;
    }
    throw err;
  }
}
