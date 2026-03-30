import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import {
  getCalendarClient,
  fetchCalendarList,
  fetchEvents,
  watchCalendar,
  fetchAttendeePhotos,
} from "../lib/google-calendar.js";
import { extractMeetingLink } from "./meeting-link.js";
import { publishSSE } from "../lib/sse.js";
import { generateId } from "@brett/utils";
import { createHmac } from "crypto";
import type { calendar_v3 } from "googleapis";

const SYNC_WINDOW_PAST_DAYS = 30;
const SYNC_WINDOW_FUTURE_DAYS = 90;

/** Guards against concurrent syncs for the same account */
const inFlightSyncs = new Set<string>();

/** Post-sync cooldown: tracks when each account last finished syncing */
const lastSyncCompleted = new Map<string, number>();
const SYNC_COOLDOWN_MS = 30_000; // 30 seconds

/** 410 backoff: tracks consecutive full-fetch fallbacks per calendar */
const fullFetchBackoff = new Map<string, { attempts: number; nextAllowedAt: number }>();
const BACKOFF_BASE_MS = 15_000; // 15s, 30s, 60s, 120s...
const BACKOFF_MAX_MS = 5 * 60_000; // 5 minutes

function isSyncOnCooldown(googleAccountId: string): boolean {
  const lastCompleted = lastSyncCompleted.get(googleAccountId);
  if (!lastCompleted) return false;
  return Date.now() - lastCompleted < SYNC_COOLDOWN_MS;
}

function recordSyncCompleted(googleAccountId: string): void {
  lastSyncCompleted.set(googleAccountId, Date.now());
}

function getBackoffDelay(calendarId: string): number {
  const entry = fullFetchBackoff.get(calendarId);
  if (!entry) return 0;
  const remaining = entry.nextAllowedAt - Date.now();
  return Math.max(0, remaining);
}

function recordFullFetchFallback(calendarId: string): void {
  const entry = fullFetchBackoff.get(calendarId) ?? { attempts: 0, nextAllowedAt: 0 };
  entry.attempts++;
  const delay = Math.min(BACKOFF_BASE_MS * Math.pow(2, entry.attempts - 1), BACKOFF_MAX_MS);
  entry.nextAllowedAt = Date.now() + delay;
  fullFetchBackoff.set(calendarId, entry);
}

function clearBackoff(calendarId: string): void {
  fullFetchBackoff.delete(calendarId);
}

type SyncChangeset = { created: string[]; updated: string[]; deleted: string[] };

function getSyncTimeRange(): { timeMin: string; timeMax: string } {
  const now = new Date();
  const timeMin = new Date(now);
  timeMin.setDate(timeMin.getDate() - SYNC_WINDOW_PAST_DAYS);
  const timeMax = new Date(now);
  timeMax.setDate(timeMax.getDate() + SYNC_WINDOW_FUTURE_DAYS);
  return {
    timeMin: timeMin.toISOString(),
    timeMax: timeMax.toISOString(),
  };
}

/**
 * Full sync on account connect.
 * Fetches calendar list, upserts calendars, fetches events for each,
 * registers webhooks, and publishes SSE completion event.
 */
export async function initialSync(googleAccountId: string): Promise<void> {
  const account = await prisma.googleAccount.findUniqueOrThrow({
    where: { id: googleAccountId },
  });

  const client = await getCalendarClient(googleAccountId);
  const calendars = await fetchCalendarList(client);

  const { timeMin, timeMax } = getSyncTimeRange();
  const changeset: SyncChangeset = { created: [], updated: [], deleted: [] };

  for (const cal of calendars) {
    if (!cal.id) continue;

    const calendarList = await prisma.calendarList.upsert({
      where: {
        googleAccountId_googleCalendarId: {
          googleAccountId,
          googleCalendarId: cal.id,
        },
      },
      create: {
        googleAccountId,
        googleCalendarId: cal.id,
        name: cal.summary ?? cal.id,
        color: cal.backgroundColor ?? "#4285f4",
        isPrimary: cal.primary ?? false,
        isVisible: true,
      },
      update: {
        name: cal.summary ?? cal.id,
        color: cal.backgroundColor ?? "#4285f4",
        isPrimary: cal.primary ?? false,
      },
    });

    const { events, nextSyncToken } = await fetchEvents(client, cal.id, {
      timeMin,
      timeMax,
    });

    const calChanges = await upsertEvents(events, account.userId, googleAccountId, calendarList.id);
    changeset.created.push(...calChanges.created);
    changeset.updated.push(...calChanges.updated);
    changeset.deleted.push(...calChanges.deleted);

    if (nextSyncToken) {
      await prisma.calendarList.update({
        where: { id: calendarList.id },
        data: { syncToken: nextSyncToken },
      });
    }

    await registerWebhook(client, calendarList.id, cal.id);
  }

  // Batch-resolve attendee photos after all events are synced
  await resolveAttendeePhotos(googleAccountId, account.userId);

  publishSSE(account.userId, {
    type: "calendar.sync.complete",
    payload: { googleAccountId, changeset },
  });
}

/**
 * Webhook-triggered incremental sync.
 * Uses per-calendar syncTokens to fetch only changes.
 * Falls back to full fetch if syncToken is missing or expired (410).
 */
export async function incrementalSync(googleAccountId: string): Promise<void> {
  if (inFlightSyncs.has(googleAccountId)) return;
  if (isSyncOnCooldown(googleAccountId)) {
    console.log(`[calendar-sync] Skipping sync for ${googleAccountId} — cooldown active`);
    return;
  }
  inFlightSyncs.add(googleAccountId);

  try {
    const account = await prisma.googleAccount.findUniqueOrThrow({
      where: { id: googleAccountId },
    });

    const client = await getCalendarClient(googleAccountId);

    // Refresh calendar list metadata (name, color) from Google
    try {
      const googleCalendars = await fetchCalendarList(client);
      for (const gcal of googleCalendars) {
        if (!gcal.id) continue;
        await prisma.calendarList.updateMany({
          where: { googleAccountId, googleCalendarId: gcal.id },
          data: {
            name: gcal.summary ?? gcal.id,
            color: gcal.backgroundColor ?? "#4285f4",
          },
        });
      }
    } catch (err) {
      // Non-fatal — calendar metadata refresh is best-effort
      console.warn("[calendar-sync] Failed to refresh calendar list metadata:", err);
    }

    const calendarLists = await prisma.calendarList.findMany({
      where: { googleAccountId },
    });

    const changeset: SyncChangeset = { created: [], updated: [], deleted: [] };

    for (const cal of calendarLists) {
      try {
        if (!cal.syncToken) {
          // No syncToken — do a full fetch, but respect backoff from prior 410s
          const backoffDelay = getBackoffDelay(cal.googleCalendarId);
          if (backoffDelay > 0) {
            console.log(
              `[calendar-sync] Skipping full fetch for ${cal.googleCalendarId} — backoff ${Math.round(backoffDelay / 1000)}s remaining`,
            );
            continue;
          }

          const { timeMin, timeMax } = getSyncTimeRange();
          const { events, nextSyncToken } = await fetchEvents(
            client,
            cal.googleCalendarId,
            { timeMin, timeMax },
          );

          const calChanges = await upsertEvents(events, account.userId, googleAccountId, cal.id);
          changeset.created.push(...calChanges.created);
          changeset.updated.push(...calChanges.updated);
          changeset.deleted.push(...calChanges.deleted);

          if (nextSyncToken) {
            await prisma.calendarList.update({
              where: { id: cal.id },
              data: { syncToken: nextSyncToken },
            });
            // Successful full fetch — clear any backoff
            clearBackoff(cal.googleCalendarId);
          }
        } else {
          // Incremental fetch using syncToken
          const { events, nextSyncToken } = await fetchEvents(
            client,
            cal.googleCalendarId,
            { syncToken: cal.syncToken },
          );

          const calChanges = await upsertEvents(events, account.userId, googleAccountId, cal.id);
          changeset.created.push(...calChanges.created);
          changeset.updated.push(...calChanges.updated);
          changeset.deleted.push(...calChanges.deleted);

          if (nextSyncToken) {
            await prisma.calendarList.update({
              where: { id: cal.id },
              data: { syncToken: nextSyncToken },
            });
          }
        }
      } catch (err: unknown) {
        if (isGoogleApiError(err) && err.code === 410) {
          // 410 Gone — syncToken is invalid, clear it and apply exponential backoff
          await prisma.calendarList.update({
            where: { id: cal.id },
            data: { syncToken: null },
          });
          recordFullFetchFallback(cal.googleCalendarId);
          const entry = fullFetchBackoff.get(cal.googleCalendarId);
          console.warn(
            `[calendar-sync] syncToken expired for calendar ${cal.googleCalendarId}, ` +
            `cleared — backoff attempt #${entry?.attempts}, next retry in ${Math.round((entry?.nextAllowedAt ?? 0 - Date.now()) / 1000)}s`,
          );
        } else if (isGoogleApiError(err) && (err.code === 401 || err.code === 403)) {
          // Token revoked or permission denied — stop syncing this account
          console.error(
            `[calendar-sync] Auth failed for account ${googleAccountId} (${err.code}): ${err.message}. Account needs re-authorization.`,
          );
          return;
        } else {
          throw err;
        }
      }
    }

    publishSSE(account.userId, {
      type: "calendar.sync.complete",
      payload: { googleAccountId, changeset },
    });
  } finally {
    inFlightSyncs.delete(googleAccountId);
    recordSyncCompleted(googleAccountId);
  }
}

/** Per-account cooldown for on-demand fetches */
const lastOnDemandFetch = new Map<string, number>();
const ON_DEMAND_COOLDOWN_MS = 60_000; // 60 seconds

/**
 * On-demand fetch for browsing outside the default sync window.
 * Fetches events in the specified time range without using syncTokens.
 * Enforces a 60s per-account cooldown to avoid request storms.
 */
export async function onDemandFetch(
  googleAccountId: string,
  timeMin: string,
  timeMax: string,
): Promise<void> {
  const lastFetch = lastOnDemandFetch.get(googleAccountId);
  if (lastFetch && Date.now() - lastFetch < ON_DEMAND_COOLDOWN_MS) {
    console.log(`[calendar-sync] Skipping on-demand fetch for ${googleAccountId} — cooldown active`);
    return;
  }
  lastOnDemandFetch.set(googleAccountId, Date.now());

  const account = await prisma.googleAccount.findUniqueOrThrow({
    where: { id: googleAccountId },
  });

  const client = await getCalendarClient(googleAccountId);

  const calendarLists = await prisma.calendarList.findMany({
    where: { googleAccountId, isVisible: true },
  });

  const changeset: SyncChangeset = { created: [], updated: [], deleted: [] };

  for (const cal of calendarLists) {
    const { events } = await fetchEvents(client, cal.googleCalendarId, {
      timeMin,
      timeMax,
    });

    const calChanges = await upsertEvents(events, account.userId, googleAccountId, cal.id);
    changeset.created.push(...calChanges.created);
    changeset.updated.push(...calChanges.updated);
    changeset.deleted.push(...calChanges.deleted);
  }

  publishSSE(account.userId, {
    type: "calendar.sync.complete",
    payload: { googleAccountId, changeset },
  });
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/** In-memory photo cache: email → { url, fetchedAt } */
const photoCache = new Map<string, { url: string; fetchedAt: number }>();
const PHOTO_CACHE_TTL_MS = 48 * 60 * 60 * 1000; // 48 hours

function getCachedPhoto(email: string): string | undefined {
  const entry = photoCache.get(email);
  if (!entry) return undefined;
  if (Date.now() - entry.fetchedAt > PHOTO_CACHE_TTL_MS) {
    photoCache.delete(email);
    return undefined;
  }
  return entry.url;
}

/** Batch-resolve attendee photos via People API and update stored attendees JSON.
 *  Uses a 48h in-memory cache to avoid redundant People API calls. */
async function resolveAttendeePhotos(
  googleAccountId: string,
  userId: string,
): Promise<void> {
  try {
    // Collect all unique attendee emails from this account's events
    const events = await prisma.calendarEvent.findMany({
      where: { googleAccountId },
      select: { id: true, attendees: true },
    });

    const allEmails = new Set<string>();
    for (const event of events) {
      const attendees = event.attendees as any[] | null;
      if (!attendees) continue;
      for (const a of attendees) {
        if (a.email) allEmails.add(a.email.toLowerCase());
      }
    }

    if (allEmails.size === 0) return;

    // Split into cached and uncached emails
    const uncachedEmails: string[] = [];
    const mergedPhotoMap = new Map<string, string>();

    for (const email of allEmails) {
      const cached = getCachedPhoto(email);
      if (cached) {
        mergedPhotoMap.set(email, cached);
      } else {
        uncachedEmails.push(email);
      }
    }

    // Only hit People API for uncached emails
    if (uncachedEmails.length > 0) {
      const freshPhotos = await fetchAttendeePhotos(googleAccountId, uncachedEmails);
      const now = Date.now();
      for (const [email, url] of freshPhotos) {
        photoCache.set(email, { url, fetchedAt: now });
        mergedPhotoMap.set(email, url);
      }
      // Cache misses too — avoid re-fetching emails with no photo
      for (const email of uncachedEmails) {
        if (!freshPhotos.has(email)) {
          photoCache.set(email, { url: "", fetchedAt: now });
        }
      }
    }

    if (mergedPhotoMap.size === 0) return;

    // Update attendees JSON with photo URLs
    for (const event of events) {
      const attendees = event.attendees as any[] | null;
      if (!attendees) continue;

      let updated = false;
      const newAttendees = attendees.map((a) => {
        if (a.email) {
          const photo = mergedPhotoMap.get(a.email.toLowerCase());
          if (photo && photo !== a.photoUrl) {
            updated = true;
            return { ...a, photoUrl: photo };
          }
        }
        return a;
      });

      if (updated) {
        await prisma.calendarEvent.update({
          where: { id: event.id },
          data: { attendees: newAttendees },
        });
      }
    }
  } catch (err) {
    // Non-fatal — photos are a nice-to-have
    console.warn("[calendar-sync] Failed to resolve attendee photos:", err);
  }
}

async function upsertEvents(
  events: calendar_v3.Schema$Event[],
  userId: string,
  googleAccountId: string,
  calendarListId: string,
): Promise<SyncChangeset> {
  const created: string[] = [];
  const updated: string[] = [];
  const deleted: string[] = [];

  for (const event of events) {
    if (!event.id) continue;

    // Handle cancelled events — soft-delete by setting status, preserving user notes
    if (event.status === "cancelled") {
      const existing = await prisma.calendarEvent.findUnique({
        where: {
          googleAccountId_googleEventId: {
            googleAccountId,
            googleEventId: event.id,
          },
        },
      });
      if (existing) {
        await prisma.calendarEvent.update({
          where: { id: existing.id },
          data: { status: "cancelled" },
        });
        deleted.push(existing.id);
      }
      continue;
    }

    // Parse start/end times
    const isAllDay = !event.start?.dateTime && !!event.start?.date;
    const startTime = event.start?.dateTime
      ? new Date(event.start.dateTime)
      : event.start?.date
        ? new Date(event.start.date)
        : new Date();
    const endTime = event.end?.dateTime
      ? new Date(event.end.dateTime)
      : event.end?.date
        ? new Date(event.end.date)
        : new Date();

    // Find self attendee for response status
    const selfAttendee = event.attendees?.find((a) => a.self);
    const isOrganizer = event.organizer?.self === true;
    // If user isn't an attendee and isn't the organizer, they're just observing
    // a shared calendar event — mark as "observer" so AI skills can filter it out
    const myResponseStatus = selfAttendee?.responseStatus
      ?? (isOrganizer ? "accepted" : "observer");

    // Extract meeting link
    const meetingLink = extractMeetingLink(event);

    // Build organizer JSON (Prisma requires DbNull for nullable Json fields)
    const organizer: Prisma.InputJsonValue | typeof Prisma.DbNull = event.organizer
      ? { email: event.organizer.email ?? null, displayName: event.organizer.displayName ?? null, self: event.organizer.self ?? false }
      : Prisma.DbNull;

    // Build attendees JSON
    const attendees: Prisma.InputJsonValue | typeof Prisma.DbNull = event.attendees
      ? event.attendees.map((a) => ({
          email: a.email ?? null,
          displayName: a.displayName ?? null,
          responseStatus: a.responseStatus ?? null,
          comment: a.comment ?? null,
          self: a.self ?? false,
          organizer: a.organizer ?? false,
        }))
      : Prisma.DbNull;

    // Build attachments JSON
    const attachments: Prisma.InputJsonValue | typeof Prisma.DbNull = event.attachments
      ? event.attachments.map((a) => ({
          fileId: a.fileId ?? null,
          fileUrl: a.fileUrl ?? null,
          title: a.title ?? null,
          mimeType: a.mimeType ?? null,
          iconLink: a.iconLink ?? null,
        }))
      : Prisma.DbNull;

    const syncedAt = new Date();
    const eventData = {
      userId,
      googleAccountId,
      calendarListId,
      googleEventId: event.id,
      title: event.summary ?? "(No title)",
      description: event.description ?? null,
      location: event.location ?? null,
      startTime,
      endTime,
      isAllDay,
      status: event.status ?? "confirmed",
      myResponseStatus,
      recurrence: event.recurrence?.join("\n") ?? null,
      recurringEventId: event.recurringEventId ?? null,
      meetingLink,
      googleColorId: event.colorId ?? null,
      organizer,
      attendees,
      attachments,
      rawGoogleEvent: scrubRawEvent(event) as Prisma.InputJsonValue,
      syncedAt,
    };

    // On update, don't overwrite myResponseStatus or attendees — the local
    // RSVP handler may have set them more recently than Google's data.
    // These fields will converge on the next full sync when Google has propagated.
    const { myResponseStatus: _mrs, attendees: _att, ...updateData } = eventData;

    const result = await prisma.calendarEvent.upsert({
      where: {
        googleAccountId_googleEventId: {
          googleAccountId,
          googleEventId: event.id,
        },
      },
      create: eventData,
      update: updateData,
    });

    // Determine create vs update: if createdAt is within 1s of syncedAt, it was just created
    const isNew = Math.abs(result.createdAt.getTime() - syncedAt.getTime()) < 1000;
    if (isNew) {
      created.push(result.id);
    } else {
      updated.push(result.id);
    }
  }

  return { created, updated, deleted };
}

async function registerWebhook(
  client: calendar_v3.Calendar,
  calendarListId: string,
  googleCalendarId: string,
): Promise<void> {
  const webhookBaseUrl = process.env.GOOGLE_WEBHOOK_BASE_URL;
  if (!webhookBaseUrl) return;

  const hmacSecret = process.env.CALENDAR_WEBHOOK_HMAC_KEY;
  if (!hmacSecret) {
    console.warn("[calendar-sync] CALENDAR_WEBHOOK_HMAC_KEY not set, skipping webhook registration");
    return;
  }

  try {
    const channelId = generateId();
    const token = createHmac("sha256", hmacSecret)
      .update(channelId)
      .digest("hex");

    const channel = await watchCalendar(client, googleCalendarId, channelId, token);

    await prisma.calendarList.update({
      where: { id: calendarListId },
      data: {
        watchChannelId: channelId,
        watchResourceId: channel.resourceId ?? null,
        watchToken: token,
        watchExpiration: channel.expiration
          ? new Date(Number(channel.expiration))
          : null,
      },
    });
  } catch (err) {
    console.error(
      `[calendar-sync] Failed to register webhook for calendar ${googleCalendarId}:`,
      err,
    );
    // Non-fatal: don't throw
  }
}

/** Strip PII from raw Google event before storing. Keep structure for debugging. */
function scrubRawEvent(event: calendar_v3.Schema$Event): Record<string, unknown> {
  const { attendees, creator, organizer, description, conferenceData, extendedProperties, ...safe } = event;
  return {
    ...safe,
    attendees: attendees?.map((a) => ({
      responseStatus: a.responseStatus,
      self: a.self,
      organizer: a.organizer,
    })),
    organizer: organizer ? { self: organizer.self } : undefined,
    creator: creator ? { self: creator.self } : undefined,
    // Strip description — may contain sensitive content like dial-in PINs
    description: description ? "[redacted]" : undefined,
  };
}

function isGoogleApiError(err: unknown): err is { code: number; message: string } {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    typeof (err as { code: unknown }).code === "number"
  );
}
