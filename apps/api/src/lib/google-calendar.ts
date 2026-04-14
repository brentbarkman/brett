import { google, type calendar_v3, type people_v1 } from "googleapis";
import { prisma } from "./prisma.js";
import { decryptToken, encryptToken } from "./encryption.js";
import { googleThrottle } from "./google-throttle.js";

/** Per-account mutex to prevent concurrent token refreshes */
const clientCache = new Map<string, Promise<calendar_v3.Calendar>>();

const BASE_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/contacts.readonly",
  "https://www.googleapis.com/auth/contacts.other.readonly",
  "openid",
  "email",
  "profile",
];

const MEETING_NOTES_SCOPES = [
  "https://www.googleapis.com/auth/documents.readonly",
];

function getOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${process.env.BETTER_AUTH_URL}/calendar/accounts/callback`,
  );
}

/** Generate OAuth URL for calendar connection */
export function getCalendarAuthUrl(state: string, includeMeetingNotes = true): string {
  const oauth2Client = getOAuthClient();
  const scopes = includeMeetingNotes
    ? [...BASE_SCOPES, ...MEETING_NOTES_SCOPES]
    : BASE_SCOPES;
  return oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: scopes,
    state,
    prompt: "consent",
  });
}

/** Generate OAuth URL for re-auth (incremental scope upgrade) */
export function getCalendarReauthUrl(state: string, loginHint: string): string {
  const oauth2Client = getOAuthClient();
  return oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: [...BASE_SCOPES, ...MEETING_NOTES_SCOPES],
    state,
    prompt: "consent",
    include_granted_scopes: true,
    login_hint: loginHint,
  });
}

/** Exchange auth code for tokens */
export async function exchangeCalendarCode(code: string) {
  const oauth2Client = getOAuthClient();
  const { tokens } = await oauth2Client.getToken(code);
  return tokens;
}

/** Get authenticated Calendar API client for a GoogleAccount. Auto-refreshes tokens. */
export async function getCalendarClient(
  googleAccountId: string,
): Promise<calendar_v3.Calendar> {
  // Return existing pending client creation to prevent concurrent token refreshes
  const pending = clientCache.get(googleAccountId);
  if (pending) return pending;

  const promise = createCalendarClient(googleAccountId);
  clientCache.set(googleAccountId, promise);
  promise.finally(() => clientCache.delete(googleAccountId));

  return promise;
}

async function createCalendarClient(
  googleAccountId: string,
): Promise<calendar_v3.Calendar> {
  const account = await prisma.googleAccount.findUniqueOrThrow({
    where: { id: googleAccountId },
  });

  const oauth2Client = getOAuthClient();
  oauth2Client.setCredentials({
    access_token: decryptToken(account.accessToken),
    refresh_token: decryptToken(account.refreshToken),
    expiry_date: account.tokenExpiresAt.getTime(),
  });

  // Auto-refresh: when googleapis refreshes the token, persist it
  oauth2Client.on("tokens", async (tokens) => {
    const updateData: Record<string, unknown> = {};
    if (tokens.access_token) {
      updateData.accessToken = encryptToken(tokens.access_token);
    }
    if (tokens.refresh_token) {
      console.log(`[google-calendar] Refresh token rotated for account ${googleAccountId}`);
      updateData.refreshToken = encryptToken(tokens.refresh_token);
    }
    if (tokens.expiry_date) {
      updateData.tokenExpiresAt = new Date(tokens.expiry_date);
    }
    if (Object.keys(updateData).length > 0) {
      await prisma.googleAccount.update({
        where: { id: googleAccountId },
        data: updateData,
      }).catch((err) => {
        console.error(`[google-calendar] Failed to persist refreshed tokens for ${googleAccountId}:`, err);
      });
    }
  });

  return google.calendar({ version: "v3", auth: oauth2Client });
}

/** Fetch all calendars for the authenticated user */
export async function fetchCalendarList(
  calendarClient: calendar_v3.Calendar,
): Promise<calendar_v3.Schema$CalendarListEntry[]> {
  await googleThrottle();
  const res = await calendarClient.calendarList.list();
  return res.data.items ?? [];
}

interface FetchEventsOptions {
  timeMin?: string;
  timeMax?: string;
  syncToken?: string;
  maxResults?: number;
}

interface FetchEventsResult {
  events: calendar_v3.Schema$Event[];
  nextSyncToken: string | null | undefined;
}

/** Fetch events with optional syncToken for incremental sync. Handles pagination. */
export async function fetchEvents(
  calendarClient: calendar_v3.Calendar,
  calendarId: string,
  options: FetchEventsOptions = {},
): Promise<FetchEventsResult> {
  const allEvents: calendar_v3.Schema$Event[] = [];
  let pageToken: string | undefined;
  let nextSyncToken: string | null | undefined;

  do {
    const params: calendar_v3.Params$Resource$Events$List = {
      calendarId,
      maxResults: options.maxResults ?? 250,
      singleEvents: true,
      orderBy: "startTime",
      pageToken,
    };

    if (options.syncToken) {
      params.syncToken = options.syncToken;
    } else {
      if (options.timeMin) params.timeMin = options.timeMin;
      if (options.timeMax) params.timeMax = options.timeMax;
    }

    await googleThrottle();
    const res = await calendarClient.events.list(params);
    const items = res.data.items ?? [];
    allEvents.push(...items);

    pageToken = res.data.nextPageToken ?? undefined;
    nextSyncToken = res.data.nextSyncToken;
  } while (pageToken);

  return { events: allEvents, nextSyncToken };
}

/** Update RSVP status for an event */
export async function updateRsvp(
  calendarClient: calendar_v3.Calendar,
  calendarId: string,
  eventId: string,
  selfEmail: string,
  status: "accepted" | "declined" | "tentative",
  comment?: string,
): Promise<calendar_v3.Schema$Event> {
  await googleThrottle();
  const eventRes = await calendarClient.events.get({ calendarId, eventId });
  const event = eventRes.data;

  const attendees = event.attendees ?? [];
  const selfAttendee = attendees.find(
    (a) => a.self === true || a.email?.toLowerCase() === selfEmail.toLowerCase(),
  );

  if (!selfAttendee) {
    console.warn(`[google-calendar] RSVP: self attendee not found for ${selfEmail} in event ${eventId} (${attendees.length} attendees)`);
    // Return the event as-is — can't RSVP if we're not an attendee
    return event;
  }

  selfAttendee.responseStatus = status;
  // Always sync the comment — empty string or undefined clears it
  selfAttendee.comment = comment || undefined;

  await googleThrottle();
  const res = await calendarClient.events.patch({
    calendarId,
    eventId,
    sendUpdates: "none",
    requestBody: { attendees },
  });

  return res.data;
}

/** Register webhook watch on a calendar */
export async function watchCalendar(
  calendarClient: calendar_v3.Calendar,
  calendarId: string,
  channelId: string,
  token: string,
): Promise<calendar_v3.Schema$Channel> {
  await googleThrottle();
  const res = await calendarClient.events.watch({
    calendarId,
    requestBody: {
      id: channelId,
      type: "web_hook",
      address: `${process.env.BETTER_AUTH_URL}/calendar/webhook`,
      token,
    },
  });
  return res.data;
}

/** Stop webhook watch */
export async function stopWatch(
  calendarClient: calendar_v3.Calendar,
  channelId: string,
  resourceId: string,
): Promise<void> {
  await googleThrottle();
  await calendarClient.channels.stop({
    requestBody: {
      id: channelId,
      resourceId,
    },
  });
}

/** Fetch Google color definitions */
export async function fetchColors(
  calendarClient: calendar_v3.Calendar,
): Promise<calendar_v3.Schema$Colors> {
  await googleThrottle();
  const res = await calendarClient.colors.get();
  return res.data;
}

/** Batch-resolve profile photos from email addresses via People API.
 *  Fetches from three sources: user's own profile, My Contacts, and Other Contacts. */
export async function fetchAttendeePhotos(
  googleAccountId: string,
  emails: string[],
): Promise<Map<string, string>> {
  if (emails.length === 0) return new Map();

  const account = await prisma.googleAccount.findUniqueOrThrow({
    where: { id: googleAccountId },
  });

  const oauth2Client = getOAuthClient();
  oauth2Client.setCredentials({
    access_token: decryptToken(account.accessToken),
    refresh_token: decryptToken(account.refreshToken),
    expiry_date: account.tokenExpiresAt.getTime(),
  });

  const people = google.people({ version: "v1", auth: oauth2Client });
  const photoMap = new Map<string, string>();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function extractPhotos(contacts: any[]) {
    for (const contact of contacts) {
      const emails = contact.emailAddresses ?? [];
      const photos = contact.photos ?? [];
      const photo = photos.find((p: any) => !p.default)?.url ?? photos[0]?.url;
      if (!photo) continue;
      for (const ea of emails) {
        if (ea.value) photoMap.set(ea.value.toLowerCase(), photo);
      }
    }
  }

  try {
    // 1. The authenticated user's own profile photo
    await googleThrottle();
    const meRes = await people.people.get({
      resourceName: "people/me",
      personFields: "emailAddresses,photos",
    });
    if (meRes.data) extractPhotos([meRes.data]);
  } catch {
    // profile scope may not cover this — non-fatal
  }

  try {
    // 2. My Contacts (requires contacts.readonly)
    let nextPageToken: string | undefined;
    do {
      await googleThrottle();
      const res = await people.people.connections.list({
        resourceName: "people/me",
        personFields: "emailAddresses,photos",
        pageSize: 1000,
        pageToken: nextPageToken,
      });
      extractPhotos(res.data.connections ?? []);
      nextPageToken = res.data.nextPageToken ?? undefined;
    } while (nextPageToken);
  } catch {
    // contacts.readonly not granted — non-fatal
  }

  try {
    // 3. Other Contacts (requires contacts.other.readonly)
    await googleThrottle();
    const res = await people.otherContacts.list({
      readMask: "emailAddresses,photos",
      pageSize: 1000,
    });
    extractPhotos(res.data.otherContacts ?? []);
  } catch {
    // contacts.other.readonly not granted — non-fatal
  }

  return photoMap;
}
