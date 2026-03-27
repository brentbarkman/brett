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
    select: {
      timezone: true,
      timezoneAuto: true,
      city: true,
      countryCode: true,
      latitude: true,
      longitude: true,
      tempUnit: true,
      weatherEnabled: true,
    },
  });

  return c.json({
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.image,
    timezone: fullUser?.timezone ?? "America/Los_Angeles",
    timezoneAuto: fullUser?.timezoneAuto ?? true,
    city: fullUser?.city ?? null,
    countryCode: fullUser?.countryCode ?? null,
    latitude: fullUser?.latitude ?? null,
    longitude: fullUser?.longitude ?? null,
    tempUnit: fullUser?.tempUnit ?? "auto",
    weatherEnabled: fullUser?.weatherEnabled ?? true,
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

  if (typeof body.auto !== "boolean") {
    return c.json({ error: "auto is required and must be a boolean" }, 400);
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      timezone: body.timezone,
      timezoneAuto: body.auto,
    },
  });

  // Invalidate weather cache — timezone affects forecast hours/days
  await prisma.weatherCache.deleteMany({ where: { userId: user.id } });

  return c.json({ timezone: body.timezone, timezoneAuto: body.auto });
});

// PATCH /users/location — update weather/location preferences
const VALID_TEMP_UNITS = new Set(["auto", "fahrenheit", "celsius"]);

users.patch("/location", authMiddleware, async (c) => {
  const user = c.get("user");
  const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;

  if (!body) {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const { city, countryCode, latitude, longitude, tempUnit, weatherEnabled, timezone } = body;

  // Validate tempUnit if provided
  if (tempUnit !== undefined && (typeof tempUnit !== "string" || !VALID_TEMP_UNITS.has(tempUnit))) {
    return c.json({ error: "tempUnit must be one of: auto, fahrenheit, celsius" }, 400);
  }

  // Build update data with only provided fields
  const data: Record<string, unknown> = {};
  if (city !== undefined) data.city = city;
  if (countryCode !== undefined) data.countryCode = countryCode;
  if (latitude !== undefined) data.latitude = latitude;
  if (longitude !== undefined) data.longitude = longitude;
  if (tempUnit !== undefined) data.tempUnit = tempUnit;
  if (weatherEnabled !== undefined) data.weatherEnabled = weatherEnabled;
  if (timezone !== undefined) data.timezone = timezone;

  if (Object.keys(data).length === 0) {
    return c.json({ error: "No fields provided" }, 400);
  }

  // If location changed, invalidate weather cache
  const locationChanged = city !== undefined || latitude !== undefined || longitude !== undefined;
  if (locationChanged) {
    await prisma.weatherCache.deleteMany({ where: { userId: user.id } });
  }

  const updated = await prisma.user.update({
    where: { id: user.id },
    data,
    select: {
      city: true,
      countryCode: true,
      latitude: true,
      longitude: true,
      tempUnit: true,
      weatherEnabled: true,
      timezone: true,
    },
  });

  return c.json(updated);
});

export { users };
