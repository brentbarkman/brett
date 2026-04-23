import { Hono } from "hono";
import { prisma } from "../lib/prisma.js";
import { authMiddleware, type AuthEnv } from "../middleware/auth.js";
import { rateLimiter } from "../middleware/rate-limit.js";

const MAX_DEVICES_PER_USER = 10;
const VALID_PLATFORMS = ["ios", "android"];

export const devices = new Hono<AuthEnv>()
  .use("/*", authMiddleware)
  .use("/*", rateLimiter(10))

  .post("/register", async (c) => {
    const user = c.get("user");
    const body = await c.req.json<{ token?: string; platform?: string; appVersion?: string }>();

    // Validate token
    if (!body.token || typeof body.token !== "string" || body.token.trim() === "") {
      return c.json({ error: "token is required and must be a non-empty string" }, 400);
    }

    // Validate platform
    if (!body.platform || !VALID_PLATFORMS.includes(body.platform)) {
      return c.json({ error: `platform must be one of: ${VALID_PLATFORMS.join(", ")}` }, 400);
    }

    const token = body.token.trim();
    const platform = body.platform;
    const appVersion = body.appVersion ?? null;

    // Check if token already exists (upsert path)
    const existing = await prisma.deviceToken.findUnique({ where: { token } });

    if (existing) {
      // Refuse to reassign a token that's registered to another user.
      // Without this check any authenticated user could claim any known
      // device token by re-registering it, hijacking that device's push
      // notifications.
      if (existing.userId !== user.id) {
        return c.json(
          { error: "Token already registered to a different account" },
          409,
        );
      }
      const updated = await prisma.deviceToken.update({
        where: { token },
        data: { platform, appVersion },
      });
      return c.json(updated, 200);
    }

    // Check device count limit for this user
    const count = await prisma.deviceToken.count({ where: { userId: user.id } });
    if (count >= MAX_DEVICES_PER_USER) {
      return c.json(
        { error: `max ${MAX_DEVICES_PER_USER} devices per user` },
        400,
      );
    }

    // Create new device token
    const created = await prisma.deviceToken.create({
      data: { userId: user.id, token, platform, appVersion },
    });
    return c.json(created, 201);
  })

  .delete("/unregister", async (c) => {
    const user = c.get("user");
    const body = await c.req.json<{ token?: string }>();

    if (!body.token || typeof body.token !== "string") {
      return c.json({ error: "token is required" }, 400);
    }

    // Delete matching token for this user (idempotent — no error if not found)
    await prisma.deviceToken.deleteMany({
      where: { token: body.token, userId: user.id },
    });

    return c.json({ ok: true }, 200);
  });
