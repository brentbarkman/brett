import { Hono } from "hono";
import { authMiddleware, type AuthEnv } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";

const users = new Hono<AuthEnv>();

// Cache timezone set at module load for O(1) validation
const VALID_TIMEZONES = new Set(Intl.supportedValuesOf("timeZone"));

// GET /users/me — return the current authenticated user
users.get("/me", authMiddleware, async (c) => {
  const user = c.get("user");

  const fullUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: { timezone: true, timezoneAuto: true },
  });

  return c.json({
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.image,
    timezone: fullUser?.timezone ?? "America/Los_Angeles",
    timezoneAuto: fullUser?.timezoneAuto ?? true,
  });
});

// PATCH /users/timezone — update user timezone
users.patch("/timezone", authMiddleware, async (c) => {
  const user = c.get("user");
  const body = await c.req.json().catch(() => null) as { timezone?: unknown; auto?: unknown } | null;

  if (!body) {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  if (!body.timezone || typeof body.timezone !== "string") {
    return c.json({ error: "timezone is required and must be a string" }, 400);
  }

  if (!VALID_TIMEZONES.has(body.timezone)) {
    return c.json({ error: "Invalid timezone" }, 400);
  }

  if (body.auto !== undefined && typeof body.auto !== "boolean") {
    return c.json({ error: "auto must be a boolean" }, 400);
  }

  const autoValue = typeof body.auto === "boolean" ? body.auto : true;

  await prisma.user.update({
    where: { id: user.id },
    data: {
      timezone: body.timezone,
      timezoneAuto: autoValue,
    },
  });

  return c.json({ timezone: body.timezone, timezoneAuto: autoValue });
});

export { users };
