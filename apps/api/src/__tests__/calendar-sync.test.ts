import { describe, it, expect, beforeAll } from "vitest";
import { createTestUser } from "./helpers.js";
import { prisma } from "../lib/prisma.js";
import { encryptToken } from "../lib/encryption.js";
import { generateId } from "@brett/utils";
import { upsertEvents } from "../services/calendar-sync.js";
import type { calendar_v3 } from "googleapis";

process.env.CALENDAR_TOKEN_ENCRYPTION_KEY =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

describe("calendar-sync upsertEvents", () => {
  let userId: string;
  let googleAccountId: string;
  let calendarListId: string;

  beforeAll(async () => {
    const user = await createTestUser("Calendar Sync Test User");
    userId = user.userId;

    googleAccountId = generateId();
    await prisma.googleAccount.create({
      data: {
        id: googleAccountId,
        userId,
        googleEmail: "sync-test@gmail.com",
        googleUserId: "google-user-sync-test",
        accessToken: encryptToken("fake-access-token"),
        refreshToken: encryptToken("fake-refresh-token"),
        tokenExpiresAt: new Date(Date.now() + 3600 * 1000),
      },
    });

    calendarListId = generateId();
    await prisma.calendarList.create({
      data: {
        id: calendarListId,
        googleAccountId,
        googleCalendarId: "primary",
        name: "Sync Test Calendar",
        color: "#4285f4",
        isVisible: true,
        isPrimary: true,
      },
    });
  });

  it("propagates myResponseStatus changes from Google on update", async () => {
    // Seed: existing event where user previously hadn't responded.
    const googleEventId = `regression-${Date.now()}`;
    await prisma.calendarEvent.create({
      data: {
        userId,
        googleAccountId,
        calendarListId,
        googleEventId,
        title: "Regression — Google-side decline",
        startTime: new Date("2026-05-10T15:00:00Z"),
        endTime: new Date("2026-05-10T16:00:00Z"),
        myResponseStatus: "needsAction",
        attendees: [
          {
            email: "sync-test@gmail.com",
            displayName: "Me",
            responseStatus: "needsAction",
            self: true,
            organizer: false,
            comment: null,
          },
        ],
      },
    });

    // Sync delivers the same event but the user has now declined in Google.
    const incoming: calendar_v3.Schema$Event = {
      id: googleEventId,
      summary: "Regression — Google-side decline",
      start: { dateTime: "2026-05-10T15:00:00Z" },
      end: { dateTime: "2026-05-10T16:00:00Z" },
      status: "confirmed",
      attendees: [
        {
          email: "sync-test@gmail.com",
          self: true,
          responseStatus: "declined",
        },
      ],
    };

    await upsertEvents([incoming], userId, googleAccountId, calendarListId);

    const stored = await prisma.calendarEvent.findUniqueOrThrow({
      where: {
        googleAccountId_googleEventId: { googleAccountId, googleEventId },
      },
    });

    expect(stored.myResponseStatus).toBe("declined");
  });
});
