import { describe, it, expect, beforeAll } from "vitest";
import { createTestUser, authRequest } from "./helpers.js";
import { prisma } from "../lib/prisma.js";
import { encryptToken } from "../lib/encryption.js";
import { generateId } from "@brett/utils";

// Set encryption key before any tests run (setup.ts runs first, but this must be set for encryptToken)
process.env.CALENDAR_TOKEN_ENCRYPTION_KEY =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

describe("Calendar API routes", () => {
  let token: string;
  let userId: string;
  let googleAccountId: string;
  let calendarListId: string;
  let eventWithNullAttendees: string;
  let eventWithComment: string;

  beforeAll(async () => {
    const user = await createTestUser("Calendar Test User");
    token = user.token;
    userId = user.userId;

    // Create a GoogleAccount with fake encrypted tokens
    googleAccountId = generateId();
    await prisma.googleAccount.create({
      data: {
        id: googleAccountId,
        userId,
        googleEmail: "test@gmail.com",
        googleUserId: "google-user-123",
        accessToken: encryptToken("fake-access-token"),
        refreshToken: encryptToken("fake-refresh-token"),
        tokenExpiresAt: new Date(Date.now() + 3600 * 1000),
      },
    });

    // Create a CalendarList
    calendarListId = generateId();
    await prisma.calendarList.create({
      data: {
        id: calendarListId,
        googleAccountId,
        googleCalendarId: "primary",
        name: "Test Calendar",
        color: "#4285f4",
        isVisible: true,
        isPrimary: true,
      },
    });

    // Create event with null attendee displayNames
    eventWithNullAttendees = generateId();
    await prisma.calendarEvent.create({
      data: {
        id: eventWithNullAttendees,
        userId,
        googleAccountId,
        calendarListId,
        googleEventId: "google-event-null-attendees",
        title: "Meeting with null names",
        startTime: new Date("2026-03-18T10:00:00Z"),
        endTime: new Date("2026-03-18T11:00:00Z"),
        attendees: [
          {
            email: "test@example.com",
            displayName: null,
            responseStatus: "accepted",
            self: true,
            organizer: false,
            comment: null,
          },
          {
            email: "other@example.com",
            displayName: null,
            responseStatus: "needsAction",
            self: false,
            organizer: false,
            comment: null,
          },
        ],
      },
    });

    // Create event with RSVP comment
    eventWithComment = generateId();
    await prisma.calendarEvent.create({
      data: {
        id: eventWithComment,
        userId,
        googleAccountId,
        calendarListId,
        googleEventId: "google-event-with-comment",
        title: "Meeting with RSVP comment",
        startTime: new Date("2026-03-18T14:00:00Z"),
        endTime: new Date("2026-03-18T15:00:00Z"),
        attendees: [
          {
            email: "test@example.com",
            displayName: "Test",
            responseStatus: "tentative",
            self: true,
            organizer: false,
            comment: "Running late",
          },
        ],
      },
    });

    // Create a plain event for the date query test
    await prisma.calendarEvent.create({
      data: {
        id: generateId(),
        userId,
        googleAccountId,
        calendarListId,
        googleEventId: "google-event-plain",
        title: "Plain event",
        startTime: new Date("2026-03-18T09:00:00Z"),
        endTime: new Date("2026-03-18T09:30:00Z"),
      },
    });
  });

  // ── GET /calendar/events response shape ──

  it("returns { events: [...] } not a bare array", async () => {
    const res = await authRequest(
      "/calendar/events?date=2026-03-18",
      token,
    );
    const body = await res.json();
    expect(body).toHaveProperty("events");
    expect(Array.isArray((body as any).events)).toBe(true);
  });

  // ── GET /calendar/events with no visible calendars ──

  it("returns { events: [] } when no visible calendars", async () => {
    // Create a second user with a GoogleAccount but no visible calendars
    const user2 = await createTestUser("No Calendar User");
    const ga2 = generateId();
    await prisma.googleAccount.create({
      data: {
        id: ga2,
        userId: user2.userId,
        googleEmail: "nocal@gmail.com",
        googleUserId: "google-user-nocal",
        accessToken: encryptToken("fake-access-token"),
        refreshToken: encryptToken("fake-refresh-token"),
        tokenExpiresAt: new Date(Date.now() + 3600 * 1000),
      },
    });
    await prisma.calendarList.create({
      data: {
        id: generateId(),
        googleAccountId: ga2,
        googleCalendarId: "hidden-cal",
        name: "Hidden Calendar",
        color: "#000000",
        isVisible: false,
        isPrimary: false,
      },
    });

    const res = await authRequest(
      "/calendar/events?date=2026-03-18",
      user2.token,
    );
    const body = (await res.json()) as any;
    expect(body.events).toEqual([]);
  });

  // ── Null attendee handling ──

  it("GET /calendar/events/:id succeeds with null attendee displayNames", async () => {
    const res = await authRequest(
      `/calendar/events/${eventWithNullAttendees}`,
      token,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.title).toBe("Meeting with null names");
    expect(body.attendees).toHaveLength(2);
    expect(body.attendees[0].displayName).toBeNull();
  });

  // ── RSVP comment in attendees ──

  it("GET /calendar/events/:id returns attendee comment", async () => {
    const res = await authRequest(
      `/calendar/events/${eventWithComment}`,
      token,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.attendees[0].comment).toBe("Running late");
  });

  // ── BrettMessage userId scoping ──

  it("user B cannot see user A's brett messages via GET /events/:id/brett", async () => {
    // Create a brett message for user A's event
    await prisma.brettMessage.create({
      data: {
        id: generateId(),
        calendarEventId: eventWithNullAttendees,
        userId,
        role: "user",
        content: "Private message from user A",
      },
    });

    // Create user B
    const userB = await createTestUser("User B");

    // User B tries to access user A's event brett messages
    const res = await authRequest(
      `/calendar/events/${eventWithNullAttendees}/brett`,
      userB.token,
    );
    // Should get 404 because the event doesn't belong to user B
    expect(res.status).toBe(404);
  });

  // ── fetch-range date cap ──

  it("rejects date ranges over 366 days", async () => {
    const res = await authRequest("/calendar/events/fetch-range", token, {
      method: "POST",
      body: JSON.stringify({
        startDate: "2020-01-01",
        endDate: "2026-12-31",
      }),
    });
    expect(res.status).toBe(400);
  });

  // ── OAuth callback error handling ──

  it("returns HTML on ?error=access_denied", async () => {
    const res = await authRequest(
      "/calendar/accounts/callback?error=access_denied",
      token,
    );
    const text = await res.text();
    expect(text).toContain("Access denied");
    expect(text).toContain("</html>");
  });
});
