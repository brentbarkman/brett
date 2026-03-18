import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import {
  getCalendarClient,
  fetchCalendarList,
  fetchEvents,
  watchCalendar,
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
  inFlightSyncs.add(googleAccountId);

  try {
    const account = await prisma.googleAccount.findUniqueOrThrow({
      where: { id: googleAccountId },
    });

    const client = await getCalendarClient(googleAccountId);

    const calendarLists = await prisma.calendarList.findMany({
      where: { googleAccountId },
    });

    const changeset: SyncChangeset = { created: [], updated: [], deleted: [] };

    for (const cal of calendarLists) {
      try {
        if (!cal.syncToken) {
          // No syncToken — do a full fetch for this calendar
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
          // 410 Gone — syncToken is invalid, clear it for next sync
          await prisma.calendarList.update({
            where: { id: cal.id },
            data: { syncToken: null },
          });
          console.warn(
            `[calendar-sync] syncToken expired for calendar ${cal.googleCalendarId}, cleared for re-sync`,
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
  }
}

/**
 * On-demand fetch for browsing outside the default sync window.
 * Fetches events in the specified time range without using syncTokens.
 */
export async function onDemandFetch(
  googleAccountId: string,
  timeMin: string,
  timeMax: string,
): Promise<void> {
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

    // Handle cancelled events
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
        await prisma.calendarEvent.delete({ where: { id: existing.id } });
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
    const myResponseStatus = selfAttendee?.responseStatus ?? "needsAction";

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

    const result = await prisma.calendarEvent.upsert({
      where: {
        googleAccountId_googleEventId: {
          googleAccountId,
          googleEventId: event.id,
        },
      },
      create: eventData,
      update: eventData,
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
