import { describe, it, expect, beforeAll } from "vitest";
import { prisma } from "../lib/prisma.js";
import { createRelinkTask } from "../lib/connection-health.js";
import { encryptToken } from "../lib/encryption.js";
import { createTestUser, authRequest } from "./helpers.js";

describe("Calendar Accounts routes", () => {
  describe("DELETE /calendar/accounts/:id", () => {
    let token: string;
    let userId: string;

    beforeAll(async () => {
      const user = await createTestUser("Calendar Delete User");
      token = user.token;
      userId = user.userId;
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
});
