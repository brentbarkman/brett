import { describe, it, expect } from "vitest";
import { prisma } from "../lib/prisma.js";
import { createTestUser } from "./helpers.js";
import { GranolaProvider } from "../services/meeting-providers/granola-provider.js";

describe("GranolaProvider multi-account", () => {
  it("isAvailable returns true when at least one account exists", async () => {
    const user = await createTestUser("Multi-Granola isAvail true");
    await prisma.granolaAccount.create({
      data: {
        userId: user.userId,
        email: `multi-isavail-${Date.now()}@example.com`,
        accessToken: "encrypted:fake",
        refreshToken: "encrypted:fake",
        tokenExpiresAt: new Date(Date.now() + 3600_000),
      },
    });

    const provider = new GranolaProvider();
    expect(await provider.isAvailable(user.userId)).toBe(true);
  });

  it("isAvailable returns false when the user has zero accounts", async () => {
    const user = await createTestUser("Multi-Granola isAvail false");
    const provider = new GranolaProvider();
    expect(await provider.isAvailable(user.userId)).toBe(false);
  });

  it("allows two GranolaAccount rows for the same user with different emails", async () => {
    // Schema-level regression guard for the @@unique([userId, email]) constraint.
    const user = await createTestUser("Multi-Granola schema");

    const a = await prisma.granolaAccount.create({
      data: {
        userId: user.userId,
        email: `schema-a-${Date.now()}@example.com`,
        accessToken: "encrypted:fake",
        refreshToken: "encrypted:fake",
        tokenExpiresAt: new Date(Date.now() + 3600_000),
      },
    });
    const b = await prisma.granolaAccount.create({
      data: {
        userId: user.userId,
        email: `schema-b-${Date.now()}@example.com`,
        accessToken: "encrypted:fake",
        refreshToken: "encrypted:fake",
        tokenExpiresAt: new Date(Date.now() + 3600_000),
      },
    });

    expect(a.id).not.toBe(b.id);

    const all = await prisma.granolaAccount.findMany({
      where: { userId: user.userId },
    });
    expect(all).toHaveLength(2);
  });

  it("rejects two GranolaAccount rows with the same (userId, email)", async () => {
    const user = await createTestUser("Multi-Granola dup-email");
    const email = `dup-${Date.now()}@example.com`;

    await prisma.granolaAccount.create({
      data: {
        userId: user.userId,
        email,
        accessToken: "encrypted:fake",
        refreshToken: "encrypted:fake",
        tokenExpiresAt: new Date(Date.now() + 3600_000),
      },
    });

    await expect(
      prisma.granolaAccount.create({
        data: {
          userId: user.userId,
          email,
          accessToken: "encrypted:fake",
          refreshToken: "encrypted:fake",
          tokenExpiresAt: new Date(Date.now() + 3600_000),
        },
      }),
    ).rejects.toThrow();
  });

  it("two accounts can each have a MeetingNoteSource attached to the same MeetingNote", async () => {
    // This is the multi-account collision path: account A and account B both
    // record a meeting for the same calendar event. The coordinator's merge
    // logic creates a single MeetingNote keyed on (userId, calendarEventId)
    // and attaches one MeetingNoteSource per account. The schema constraints
    // we rely on:
    //   1. MeetingNote @@unique([userId, calendarEventId]) prevents duplicate notes
    //   2. MeetingNoteSource @@unique([provider, externalId]) prevents duplicate sources
    //   3. Multiple MeetingNoteSource rows on the same MeetingNote are allowed
    const user = await createTestUser("Multi-Granola collision");

    const accountA = await prisma.granolaAccount.create({
      data: {
        userId: user.userId,
        email: `coll-a-${Date.now()}@example.com`,
        accessToken: "encrypted:fake-a",
        refreshToken: "encrypted:fake-a",
        tokenExpiresAt: new Date(Date.now() + 3600_000),
      },
    });
    const accountB = await prisma.granolaAccount.create({
      data: {
        userId: user.userId,
        email: `coll-b-${Date.now()}@example.com`,
        accessToken: "encrypted:fake-b",
        refreshToken: "encrypted:fake-b",
        tokenExpiresAt: new Date(Date.now() + 3600_000),
      },
    });

    // The calendar event the two accounts both have meeting data for. The
    // event needs an existing CalendarEvent + GoogleAccount + CalendarList
    // since MeetingNote.calendarEventId is a FK.
    const googleAccount = await prisma.googleAccount.create({
      data: {
        userId: user.userId,
        googleEmail: `gcal-${Date.now()}@example.com`,
        googleUserId: `gid-${Date.now()}`,
        accessToken: "encrypted:fake",
        refreshToken: "encrypted:fake",
        tokenExpiresAt: new Date(Date.now() + 3600_000),
      },
    });
    const calendarList = await prisma.calendarList.create({
      data: {
        googleAccountId: googleAccount.id,
        googleCalendarId: `cal-${Date.now()}`,
        name: "Test calendar",
        color: "#000000",
        isPrimary: true,
      },
    });
    const calendarEvent = await prisma.calendarEvent.create({
      data: {
        userId: user.userId,
        googleAccountId: googleAccount.id,
        calendarListId: calendarList.id,
        googleEventId: `evt-${Date.now()}`,
        title: "Roadmap review",
        startTime: new Date("2026-05-16T15:00:00Z"),
        endTime: new Date("2026-05-16T16:00:00Z"),
        isAllDay: false,
      },
    });

    // Simulate what mergeProviderData would do for the first source.
    const meetingNote = await prisma.meetingNote.create({
      data: {
        userId: user.userId,
        calendarEventId: calendarEvent.id,
        granolaAccountId: accountA.id,
        provider: "granola",
        title: "Roadmap review",
        summary: "From account A",
        meetingStartedAt: calendarEvent.startTime,
        meetingEndedAt: calendarEvent.endTime,
        sources: ["granola"],
      },
    });
    await prisma.meetingNoteSource.create({
      data: {
        meetingNoteId: meetingNote.id,
        userId: user.userId,
        provider: "granola",
        externalId: `doc-a-${Date.now()}`,
        granolaAccountId: accountA.id,
        title: "Roadmap review",
        summary: "From account A",
      },
    });

    // Second source from account B for the same MeetingNote. The merge
    // path looks up the existing MeetingNote by (userId, calendarEventId)
    // and attaches another MeetingNoteSource — it does NOT create a new
    // MeetingNote.
    await prisma.meetingNoteSource.create({
      data: {
        meetingNoteId: meetingNote.id,
        userId: user.userId,
        provider: "granola",
        externalId: `doc-b-${Date.now()}`,
        granolaAccountId: accountB.id,
        title: "Roadmap review",
        summary: "From account B",
      },
    });

    // Assert: 1 MeetingNote, 2 MeetingNoteSource rows, both granola.
    const noteCount = await prisma.meetingNote.count({
      where: { userId: user.userId, calendarEventId: calendarEvent.id },
    });
    expect(noteCount).toBe(1);

    const sources = await prisma.meetingNoteSource.findMany({
      where: { meetingNoteId: meetingNote.id },
      orderBy: { createdAt: "asc" },
    });
    expect(sources).toHaveLength(2);
    expect(sources[0].granolaAccountId).toBe(accountA.id);
    expect(sources[1].granolaAccountId).toBe(accountB.id);
    expect(sources.every((s) => s.provider === "granola")).toBe(true);
  });

  it("creating a duplicate MeetingNote for (userId, calendarEventId) is rejected", async () => {
    // Schema-level guard that protects the collision-handling path. If this
    // constraint ever drifts, the merge logic above would silently create
    // duplicate notes per account instead of layering sources.
    const user = await createTestUser("Multi-Granola dup-note");

    const googleAccount = await prisma.googleAccount.create({
      data: {
        userId: user.userId,
        googleEmail: `gcal-dup-${Date.now()}@example.com`,
        googleUserId: `gid-dup-${Date.now()}`,
        accessToken: "encrypted:fake",
        refreshToken: "encrypted:fake",
        tokenExpiresAt: new Date(Date.now() + 3600_000),
      },
    });
    const calendarList = await prisma.calendarList.create({
      data: {
        googleAccountId: googleAccount.id,
        googleCalendarId: `cal-dup-${Date.now()}`,
        name: "Test",
        color: "#000000",
        isPrimary: true,
      },
    });
    const calendarEvent = await prisma.calendarEvent.create({
      data: {
        userId: user.userId,
        googleAccountId: googleAccount.id,
        calendarListId: calendarList.id,
        googleEventId: `evt-dup-${Date.now()}`,
        title: "Test",
        startTime: new Date(),
        endTime: new Date(Date.now() + 3600_000),
        isAllDay: false,
      },
    });

    await prisma.meetingNote.create({
      data: {
        userId: user.userId,
        calendarEventId: calendarEvent.id,
        provider: "granola",
        title: "Test",
        meetingStartedAt: new Date(),
        meetingEndedAt: new Date(Date.now() + 3600_000),
        sources: ["granola"],
      },
    });

    await expect(
      prisma.meetingNote.create({
        data: {
          userId: user.userId,
          calendarEventId: calendarEvent.id,
          provider: "granola",
          title: "Duplicate",
          meetingStartedAt: new Date(),
          meetingEndedAt: new Date(Date.now() + 3600_000),
          sources: ["granola"],
        },
      }),
    ).rejects.toThrow();
  });
});
