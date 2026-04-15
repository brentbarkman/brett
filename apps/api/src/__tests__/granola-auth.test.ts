import { describe, it, expect, beforeAll } from "vitest";
import { prisma } from "../lib/prisma.js";
import { createRelinkTask } from "../lib/connection-health.js";
import { createTestUser, authRequest } from "./helpers.js";

describe("Granola Auth routes", () => {
  describe("DELETE /granola/auth", () => {
    let token: string;
    let userId: string;

    beforeAll(async () => {
      const user = await createTestUser("Granola Delete User");
      token = user.token;
      userId = user.userId;
    });

    it("resolves the granola re-link task so the broken-connection badge clears", async () => {
      // Simulate the post-failure state: a saved Granola account and an active re-link task
      const account = await prisma.granolaAccount.create({
        data: {
          userId,
          email: `granola-${Date.now()}@example.com`,
          accessToken: "encrypted:fake",
          refreshToken: "encrypted:fake",
          tokenExpiresAt: new Date(Date.now() + 3600_000),
        },
      });
      await createRelinkTask(userId, "granola", account.id, "Token expired");

      const activeBefore = await prisma.item.findFirst({
        where: {
          userId,
          source: "system",
          sourceId: { startsWith: "relink:granola:" },
          status: "active",
        },
      });
      expect(activeBefore).not.toBeNull();

      const res = await authRequest("/granola/auth", token, {
        method: "DELETE",
      });
      expect(res.status).toBe(200);

      const activeAfter = await prisma.item.findFirst({
        where: {
          userId,
          source: "system",
          sourceId: { startsWith: "relink:granola:" },
          status: "active",
        },
      });
      expect(activeAfter).toBeNull();
    });
  });
});
