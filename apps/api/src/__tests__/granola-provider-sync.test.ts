import { describe, it, expect, vi, beforeEach } from "vitest";

// The provider iterates accounts and calls withGranolaClient(accountId, userId, fn).
// We stub withGranolaClient so the test doesn't talk to Granola, and observe the
// behavior we actually care about: that lastSyncAt gets bumped per account on
// success, and NOT bumped when a per-account call throws.
const withGranolaClientMock = vi.fn<
  (
    accountId: string,
    userId: string,
    fn: (tools: unknown) => Promise<unknown>,
  ) => Promise<unknown>
>();
vi.mock("../lib/granola-mcp.js", () => ({
  withGranolaClient: (
    accountId: string,
    userId: string,
    fn: (tools: unknown) => Promise<unknown>,
  ) => withGranolaClientMock(accountId, userId, fn),
}));

// Imports AFTER vi.mock (vi.mock is hoisted, so this is fine) — the provider
// will pick up the mocked granola-mcp module.
import { prisma } from "../lib/prisma.js";
import { createTestUser } from "./helpers.js";
import { GranolaProvider } from "../services/meeting-providers/granola-provider.js";

const emptyTools = {
  listMeetings: async () => [],
  getMeetings: async () => [],
  getTranscript: async () => null,
  query: async () => "",
};

describe("GranolaProvider lastSyncAt bookkeeping", () => {
  beforeEach(() => {
    withGranolaClientMock.mockReset();
  });

  it("bumps lastSyncAt after a successful per-account fetchRecent (even with zero meetings)", async () => {
    const user = await createTestUser("lastSyncAt success");
    const account = await prisma.granolaAccount.create({
      data: {
        userId: user.userId,
        email: `sync-ok-${Date.now()}@example.com`,
        accessToken: "encrypted:fake",
        refreshToken: "encrypted:fake",
        tokenExpiresAt: new Date(Date.now() + 3600_000),
        lastSyncAt: null,
      },
    });

    withGranolaClientMock.mockImplementation((_aid, _uid, fn) => fn(emptyTools));

    const before = new Date();
    const provider = new GranolaProvider();
    await provider.fetchRecent(
      user.userId,
      new Date(Date.now() - 24 * 3600_000),
      new Date(),
    );

    const after = await prisma.granolaAccount.findUniqueOrThrow({
      where: { id: account.id },
    });
    expect(after.lastSyncAt).not.toBeNull();
    expect(after.lastSyncAt!.getTime()).toBeGreaterThanOrEqual(before.getTime());
  });

  it("does NOT bump lastSyncAt when the per-account call throws (e.g. auth error)", async () => {
    const user = await createTestUser("lastSyncAt failure");
    const stale = new Date(Date.now() - 30 * 24 * 3600_000); // 30 days ago
    const account = await prisma.granolaAccount.create({
      data: {
        userId: user.userId,
        email: `sync-fail-${Date.now()}@example.com`,
        accessToken: "encrypted:fake",
        refreshToken: "encrypted:fake",
        tokenExpiresAt: new Date(Date.now() + 3600_000),
        lastSyncAt: stale,
      },
    });

    withGranolaClientMock.mockImplementation(async () => {
      throw new Error("HTTP error 401 Unauthorized");
    });

    const provider = new GranolaProvider();
    await provider.fetchRecent(
      user.userId,
      new Date(Date.now() - 24 * 3600_000),
      new Date(),
    );

    const after = await prisma.granolaAccount.findUniqueOrThrow({
      where: { id: account.id },
    });
    // lastSyncAt must be exactly the stale value — the failing account
    // should look unhealthy on the Settings list.
    expect(after.lastSyncAt?.getTime()).toBe(stale.getTime());
  });

  it("bumps lastSyncAt per account independently when one fails and another succeeds", async () => {
    const user = await createTestUser("lastSyncAt mixed");
    const stale = new Date(Date.now() - 30 * 24 * 3600_000);
    const accountA = await prisma.granolaAccount.create({
      data: {
        userId: user.userId,
        email: `mixed-a-${Date.now()}@example.com`,
        accessToken: "encrypted:fake-a",
        refreshToken: "encrypted:fake-a",
        tokenExpiresAt: new Date(Date.now() + 3600_000),
        lastSyncAt: stale,
      },
    });
    const accountB = await prisma.granolaAccount.create({
      data: {
        userId: user.userId,
        email: `mixed-b-${Date.now()}@example.com`,
        accessToken: "encrypted:fake-b",
        refreshToken: "encrypted:fake-b",
        tokenExpiresAt: new Date(Date.now() + 3600_000),
        lastSyncAt: stale,
      },
    });

    // Account A succeeds, account B throws auth error.
    withGranolaClientMock.mockImplementation(async (accountId, _uid, fn) => {
      if (accountId === accountA.id) return fn(emptyTools);
      throw new Error("HTTP error 403 Forbidden");
    });

    const before = new Date();
    const provider = new GranolaProvider();
    await provider.fetchRecent(
      user.userId,
      new Date(Date.now() - 24 * 3600_000),
      new Date(),
    );

    const aAfter = await prisma.granolaAccount.findUniqueOrThrow({
      where: { id: accountA.id },
    });
    const bAfter = await prisma.granolaAccount.findUniqueOrThrow({
      where: { id: accountB.id },
    });

    expect(aAfter.lastSyncAt!.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(bAfter.lastSyncAt?.getTime()).toBe(stale.getTime());
  });

  it("bumps lastSyncAt after a successful fetchForEvent call", async () => {
    const user = await createTestUser("lastSyncAt fetchForEvent");
    const account = await prisma.granolaAccount.create({
      data: {
        userId: user.userId,
        email: `evt-${Date.now()}@example.com`,
        accessToken: "encrypted:fake",
        refreshToken: "encrypted:fake",
        tokenExpiresAt: new Date(Date.now() + 3600_000),
        lastSyncAt: null,
      },
    });

    // Calendar event scaffolding (FK chain required for the typed input)
    const googleAccount = await prisma.googleAccount.create({
      data: {
        userId: user.userId,
        googleEmail: `g-${Date.now()}@example.com`,
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
        name: "Test",
        color: "#000",
        isPrimary: true,
      },
    });
    const calendarEvent = await prisma.calendarEvent.create({
      data: {
        userId: user.userId,
        googleAccountId: googleAccount.id,
        calendarListId: calendarList.id,
        googleEventId: `evt-${Date.now()}`,
        title: "Roadmap",
        startTime: new Date(Date.now() - 30 * 60_000),
        endTime: new Date(Date.now() + 30 * 60_000),
        isAllDay: false,
      },
    });

    withGranolaClientMock.mockImplementation((_aid, _uid, fn) => fn(emptyTools));

    const before = new Date();
    const provider = new GranolaProvider();
    await provider.fetchForEvent(user.userId, calendarEvent as never);

    const after = await prisma.granolaAccount.findUniqueOrThrow({
      where: { id: account.id },
    });
    expect(after.lastSyncAt).not.toBeNull();
    expect(after.lastSyncAt!.getTime()).toBeGreaterThanOrEqual(before.getTime());
  });
});
