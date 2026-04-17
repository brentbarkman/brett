import { describe, it, expect, beforeAll } from "vitest";
import { app } from "../app.js";
import { prisma } from "../lib/prisma.js";
import { createRelinkTask } from "../lib/connection-health.js";
import { createTestUser, authRequest } from "./helpers.js";

describe("AI Config routes", () => {
  let token: string;

  beforeAll(async () => {
    const user = await createTestUser("AI Config User");
    token = user.token;
  });

  it("rejects unauthenticated requests", async () => {
    const res = await app.request("/ai/config");
    expect(res.status).toBe(401);
  });

  it("GET /ai/config returns provider config", async () => {
    const res = await authRequest("/ai/config", token);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toBeDefined();
  });

  describe("DELETE /ai/config/:id", () => {
    let deleteToken: string;
    let deleteUserId: string;

    beforeAll(async () => {
      const user = await createTestUser("AI Config Delete User");
      deleteToken = user.token;
      deleteUserId = user.userId;
    });

    it("resolves the AI re-link task so the broken-connection badge clears", async () => {
      // Simulate the post-failure state: a saved AI config and an active re-link task
      const config = await prisma.userAIConfig.create({
        data: {
          userId: deleteUserId,
          provider: "anthropic",
          encryptedKey: "iv:fake:tag",
          isValid: false,
          isActive: true,
        },
      });
      await createRelinkTask(deleteUserId, "ai", config.id, "Key invalid");

      const activeBefore = await prisma.item.findFirst({
        where: {
          userId: deleteUserId,
          source: "system",
          sourceId: { startsWith: "relink:ai:" },
          status: "active",
        },
      });
      expect(activeBefore).not.toBeNull();

      const res = await authRequest(`/ai/config/${config.id}`, deleteToken, {
        method: "DELETE",
      });
      expect(res.status).toBe(200);

      const activeAfter = await prisma.item.findFirst({
        where: {
          userId: deleteUserId,
          source: "system",
          sourceId: { startsWith: "relink:ai:" },
          status: "active",
        },
      });
      expect(activeAfter).toBeNull();
    });
  });
});
