import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { prisma } from "../lib/prisma.js";
import { createRelinkTask } from "../lib/connection-health.js";
import { encryptToken } from "../lib/encryption.js";
import { createTestUser, authRequest } from "./helpers.js";
import { generateId } from "@brett/utils";

// Required for encryptToken used by the GoogleAccount fixtures below.
process.env.CALENDAR_TOKEN_ENCRYPTION_KEY =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

describe("Calendar Accounts routes", () => {
  describe("DELETE /calendar/accounts/:id", () => {
    let token: string;
    let userId: string;

    beforeAll(async () => {
      const user = await createTestUser("Calendar Delete User");
      token = user.token;
      userId = user.userId;
    });

    it("only resolves the disconnected account's re-link task, not other accounts'", async () => {
      // Regression guard for the multi-account re-link bug on Google Calendar:
      // the provider-wide resolveRelinkTask used to dismiss every Google
      // Calendar re-link task for the user — so disconnecting one account
      // would silently clear another (broken) account's prompt. We now scope
      // the resolve by accountId. Same bug pattern as Granola DELETE.
      const user = await createTestUser("Calendar DELETE scoped relink");

      const brokenAccount = await prisma.googleAccount.create({
        data: {
          userId: user.userId,
          googleEmail: `broken-${Date.now()}@example.com`,
          googleUserId: `google-broken-${Date.now()}`,
          accessToken: encryptToken("fake-access-token"),
          refreshToken: encryptToken("fake-refresh-token"),
          tokenExpiresAt: new Date(Date.now() + 3600_000),
        },
      });
      const healthyAccount = await prisma.googleAccount.create({
        data: {
          userId: user.userId,
          googleEmail: `healthy-${Date.now()}@example.com`,
          googleUserId: `google-healthy-${Date.now()}`,
          accessToken: encryptToken("fake-access-token"),
          refreshToken: encryptToken("fake-refresh-token"),
          tokenExpiresAt: new Date(Date.now() + 3600_000),
        },
      });

      // Both accounts have re-link tasks (e.g. both failed at some point)
      await createRelinkTask(user.userId, "google-calendar", brokenAccount.id, "broken");
      await createRelinkTask(user.userId, "google-calendar", healthyAccount.id, "healthy was once broken");

      const res = await authRequest(
        `/calendar/accounts/${healthyAccount.id}`,
        user.token,
        { method: "DELETE" },
      );
      expect(res.status).toBe(200);

      // The broken account's re-link task must still be active.
      const brokenTaskAfter = await prisma.item.findFirst({
        where: {
          userId: user.userId,
          source: "system",
          sourceId: `relink:google-calendar:${brokenAccount.id}`,
          status: "active",
        },
      });
      expect(brokenTaskAfter).not.toBeNull();

      // The deleted (healthy) account's re-link task should be resolved.
      const healthyTaskAfter = await prisma.item.findFirst({
        where: {
          userId: user.userId,
          source: "system",
          sourceId: `relink:google-calendar:${healthyAccount.id}`,
          status: "active",
        },
      });
      expect(healthyTaskAfter).toBeNull();
    });

    it("resolves the google-calendar re-link task so the broken-connection badge clears", async () => {
      // Simulate the post-failure state: a saved Google account and an active re-link task
      const account = await prisma.googleAccount.create({
        data: {
          userId,
          googleEmail: `fake-${Date.now()}@example.com`,
          googleUserId: `fake-google-${Date.now()}`,
          accessToken: encryptToken("fake-access-token"),
          refreshToken: encryptToken("fake-refresh-token"),
          tokenExpiresAt: new Date(Date.now() + 3600_000),
        },
      });
      await createRelinkTask(userId, "google-calendar", account.id, "Token expired");

      const activeBefore = await prisma.item.findFirst({
        where: {
          userId,
          source: "system",
          sourceId: { startsWith: "relink:google-calendar:" },
          status: "active",
        },
      });
      expect(activeBefore).not.toBeNull();

      const res = await authRequest(`/calendar/accounts/${account.id}`, token, {
        method: "DELETE",
      });
      expect(res.status).toBe(200);

      const activeAfter = await prisma.item.findFirst({
        where: {
          userId,
          source: "system",
          sourceId: { startsWith: "relink:google-calendar:" },
          status: "active",
        },
      });
      expect(activeAfter).toBeNull();
    });
  });

  describe("PATCH /calendar/accounts/:accountId/calendars/:calId", () => {
    it("hiding a calendar soft-deletes its events so iOS sync-pull tombstones them", async () => {
      const user = await createTestUser("Vis Toggle User");

      const accountId = generateId();
      await prisma.googleAccount.create({
        data: {
          id: accountId,
          userId: user.userId,
          googleEmail: `vis-toggle-${accountId}@example.com`,
          googleUserId: `google-vis-toggle-${accountId}`,
          accessToken: encryptToken("fake-access-token"),
          refreshToken: encryptToken("fake-refresh-token"),
          tokenExpiresAt: new Date(Date.now() + 3600_000),
        },
      });

      const calendarListId = generateId();
      await prisma.calendarList.create({
        data: {
          id: calendarListId,
          googleAccountId: accountId,
          googleCalendarId: "vis-toggle-cal",
          name: "Toggle Test",
          color: "#4285f4",
          isVisible: true,
          isPrimary: true,
        },
      });

      const eventId = generateId();
      const now = new Date();
      await prisma.calendarEvent.create({
        data: {
          id: eventId,
          userId: user.userId,
          googleAccountId: accountId,
          calendarListId,
          googleEventId: `vis-toggle-evt-${eventId}`,
          title: "Should disappear when calendar hidden",
          startTime: now,
          endTime: new Date(now.getTime() + 3600_000),
        },
      });

      // Toggle visibility off.
      const res = await authRequest(
        `/calendar/accounts/${accountId}/calendars/${calendarListId}`,
        user.token,
        {
          method: "PATCH",
          body: JSON.stringify({ isVisible: false }),
        },
      );
      expect(res.status).toBe(200);

      // Bypass the soft-delete extension to assert the row was tombstoned
      // rather than hard-deleted (sync-pull needs the tombstone to emit
      // a delete to the iOS client).
      const tombstoned = await prisma.calendarEvent.findFirst({
        where: { id: eventId, deletedAt: { not: null } },
      });
      expect(tombstoned).not.toBeNull();
      expect(tombstoned?.deletedAt).not.toBeNull();
    });

    it("re-showing a calendar clears syncToken so the next incrementalSync full-fetches", async () => {
      const user = await createTestUser("Vis Restore User");

      const accountId = generateId();
      await prisma.googleAccount.create({
        data: {
          id: accountId,
          userId: user.userId,
          googleEmail: `vis-restore-${accountId}@example.com`,
          googleUserId: `google-vis-restore-${accountId}`,
          accessToken: encryptToken("fake-access-token"),
          refreshToken: encryptToken("fake-refresh-token"),
          tokenExpiresAt: new Date(Date.now() + 3600_000),
        },
      });

      const calendarListId = generateId();
      await prisma.calendarList.create({
        data: {
          id: calendarListId,
          googleAccountId: accountId,
          googleCalendarId: "vis-restore-cal",
          name: "Restore Test",
          color: "#4285f4",
          isVisible: false, // already hidden
          isPrimary: false,
          syncToken: "stale-token-from-before-hide",
        },
      });

      const res = await authRequest(
        `/calendar/accounts/${accountId}/calendars/${calendarListId}`,
        user.token,
        {
          method: "PATCH",
          body: JSON.stringify({ isVisible: true }),
        },
      );
      expect(res.status).toBe(200);

      const updated = await prisma.calendarList.findUnique({
        where: { id: calendarListId },
      });
      expect(updated?.isVisible).toBe(true);
      // Cleared so the next periodic incrementalSync does a full re-fetch
      // from Google. Without this, an incremental fetch using the stale
      // token would skip the events the user wants to see again.
      expect(updated?.syncToken).toBeNull();
    });
  });

  describe("OAuth callback re-link scoping (source regression)", () => {
    // We can't easily fake the full Google OAuth callback without mocking the
    // entire googleapis chain (token exchange + userinfo.get). Instead, lock
    // in the source-level invariant that catches the bug class directly:
    // both the callback success path AND the disconnect path must use the
    // PER-ACCOUNT resolver. If anyone reverts to the provider-wide
    // `resolveRelinkTask(...)` here, reconnecting one Google Calendar account
    // would silently dismiss every other Google Calendar account's broken
    // prompt — exactly the user-visible bug we shipped a fix for.
    it("calendar-accounts.ts uses the per-account resolver, never the provider-wide one", () => {
      const here = dirname(fileURLToPath(import.meta.url));
      const source = readFileSync(
        resolve(here, "../routes/calendar-accounts.ts"),
        "utf8",
      );
      // Strip line comments and the import line — only flag actual call sites.
      const callSites = source
        .split("\n")
        .filter((line) => !line.trim().startsWith("//"))
        .filter((line) => !line.includes("import"))
        .join("\n");
      // `\b` ensures we don't match `resolveRelinkTaskForAccount`.
      expect(callSites).not.toMatch(/\bresolveRelinkTask\s*\(/);
      expect(callSites).toMatch(/resolveRelinkTaskForAccount\s*\(/);
    });
  });
});
