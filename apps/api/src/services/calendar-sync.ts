import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import {
  getCalendarClient,
  fetchCalendarList,
  fetchEvents,
  watchCalendar,
} from "../lib/google-calendar.js";
import { extractMeetingLink } from "./meeting-link.js";
import { generateId } from "@brett/utils";
import { createHmac } from "crypto";
import type { calendar_v3 } from "googleapis";

// Stub until SSE module is available
const publishSSE = (_userId: string, _event: unknown) => {
  /* no-op for now */
};

const SYNC_WINDOW_PAST_DAYS = 30;
const SYNC_WINDOW_FUTURE_DAYS = 90;

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

    await upsertEvents(events, account.userId, googleAccountId, calendarList.id);

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
    googleAccountId,
  });
}

/**
 * Webhook-triggered incremental sync.
 * Uses per-calendar syncTokens to fetch only changes.
 * Falls back to full fetch if syncToken is missing or expired (410).
 */
export async function incrementalSync(googleAccountId: string): Promise<void> {
  const account = await prisma.googleAccount.findUniqueOrThrow({
    where: { id: googleAccountId },
  });

  const client = await getCalendarClient(googleAccountId);

  const calendarLists = await prisma.calendarList.findMany({
    where: { googleAccountId, isVisible: true },
  });

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

        await upsertEvents(events, account.userId, googleAccountId, cal.id);

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

        await upsertEvents(events, account.userId, googleAccountId, cal.id);

        if (nextSyncToken) {
          await prisma.calendarList.update({
            where: { id: cal.id },
            data: { syncToken: nextSyncToken },
          });
        }
      }
    } catch (err: unknown) {
      // 410 Gone — syncToken is invalid, clear it for next sync
      if (isGoogleApiError(err) && err.code === 410) {
        await prisma.calendarList.update({
          where: { id: cal.id },
          data: { syncToken: null },
        });
        console.warn(
          `[calendar-sync] syncToken expired for calendar ${cal.googleCalendarId}, cleared for re-sync`,
        );
      } else {
        throw err;
      }
    }
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

  for (const cal of calendarLists) {
    const { events } = await fetchEvents(client, cal.googleCalendarId, {
      timeMin,
      timeMax,
    });

    await upsertEvents(events, account.userId, googleAccountId, cal.id);
  }
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

async function upsertEvents(
  events: calendar_v3.Schema$Event[],
  userId: string,
  googleAccountId: string,
  calendarListId: string,
): Promise<void> {
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
        publishSSE(userId, {
          type: "calendar.event.deleted",
          eventId: existing.id,
          googleEventId: event.id,
        });
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
      rawGoogleEvent: JSON.parse(JSON.stringify(event)) as Prisma.InputJsonValue,
      syncedAt: new Date(),
    };

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
        data: eventData,
      });
      publishSSE(userId, {
        type: "calendar.event.updated",
        eventId: existing.id,
        googleEventId: event.id,
      });
    } else {
      const created = await prisma.calendarEvent.create({ data: eventData });
      publishSSE(userId, {
        type: "calendar.event.created",
        eventId: created.id,
        googleEventId: event.id,
      });
    }
  }
}

async function registerWebhook(
  client: calendar_v3.Calendar,
  calendarListId: string,
  googleCalendarId: string,
): Promise<void> {
  const webhookBaseUrl = process.env.GOOGLE_WEBHOOK_BASE_URL;
  if (!webhookBaseUrl) return;

  const encryptionKey = process.env.CALENDAR_TOKEN_ENCRYPTION_KEY;
  if (!encryptionKey) {
    console.warn("[calendar-sync] CALENDAR_TOKEN_ENCRYPTION_KEY not set, skipping webhook registration");
    return;
  }

  try {
    const channelId = generateId();
    const token = createHmac("sha256", encryptionKey)
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

function isGoogleApiError(err: unknown): err is { code: number; message: string } {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    typeof (err as { code: unknown }).code === "number"
  );
}
