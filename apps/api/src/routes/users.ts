import { Hono } from "hono";
import { authMiddleware, type AuthEnv } from "../middleware/auth.js";
import { rateLimiter } from "../middleware/rate-limit.js";
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
      backgroundStyle: true,
      pinnedBackground: true,
      avgBusynessScore: true,
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
    backgroundStyle: fullUser?.backgroundStyle ?? "photography",
    pinnedBackground: fullUser?.pinnedBackground ?? null,
    avgBusynessScore: fullUser?.avgBusynessScore ?? 0,
  });
});

// POST /users/busyness-sync — compute and store 14-day avg busyness score
users.post("/busyness-sync", authMiddleware, async (c) => {
  const user = c.get("user");

  // Get user timezone for day boundary computation
  const userData = await prisma.user.findUnique({
    where: { id: user.id },
    select: { timezone: true },
  });
  const tz = userData?.timezone ?? "America/Los_Angeles";

  // Compute 14-day window in UTC using user's timezone
  const now = new Date();
  const fourteenDaysAgo = new Date(now);
  fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

  // Count tasks that were due in each of the past 14 days
  const tasks = await prisma.item.findMany({
    where: {
      userId: user.id,
      type: "task",
      dueDate: {
        gte: fourteenDaysAgo,
        lte: now,
      },
    },
    select: { dueDate: true },
  });

  // Count calendar events per day
  const events = await prisma.calendarEvent.findMany({
    where: {
      userId: user.id,
      startTime: {
        gte: fourteenDaysAgo,
        lte: now,
      },
      isAllDay: false, // All-day events don't count
    },
    select: { startTime: true },
  });

  // Group by calendar date in user's timezone and compute daily scores
  const dailyScores: Record<string, { meetings: number; tasks: number }> = {};

  for (let d = 0; d < 14; d++) {
    const date = new Date(now);
    date.setDate(date.getDate() - d);
    const dateKey = date.toLocaleDateString("en-CA", { timeZone: tz });
    dailyScores[dateKey] = { meetings: 0, tasks: 0 };
  }

  for (const task of tasks) {
    if (!task.dueDate) continue;
    const dateKey = task.dueDate.toLocaleDateString("en-CA", { timeZone: tz });
    if (dailyScores[dateKey]) dailyScores[dateKey].tasks++;
  }

  for (const event of events) {
    const dateKey = event.startTime.toLocaleDateString("en-CA", { timeZone: tz });
    if (dailyScores[dateKey]) dailyScores[dateKey].meetings++;
  }

  // Compute average score: (meetings * 2 + tasks) per day
  const scores = Object.values(dailyScores).map(
    (d) => d.meetings * 2 + d.tasks
  );
  const avgScore = scores.length > 0
    ? scores.reduce((a, b) => a + b, 0) / scores.length
    : 0;

  // Store it
  await prisma.user.update({
    where: { id: user.id },
    data: { avgBusynessScore: Math.round(avgScore * 10) / 10 },
  });

  return c.json({ avgBusynessScore: Math.round(avgScore * 10) / 10 });
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

users.patch("/location", authMiddleware, rateLimiter(20), async (c) => {
  const user = c.get("user");
  const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;

  if (!body) {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const { city, countryCode, latitude, longitude, tempUnit, weatherEnabled, timezone } = body;
  const backgroundStyle = body.backgroundStyle as string | undefined;

  // Validate each field before constructing data
  if (city !== undefined && (typeof city !== "string" || city.length > 200)) {
    return c.json({ error: "city must be a string (max 200 chars)" }, 400);
  }
  if (countryCode !== undefined && (typeof countryCode !== "string" || !/^[A-Z]{2}$/.test(countryCode))) {
    return c.json({ error: "countryCode must be a 2-letter ISO code" }, 400);
  }
  if (latitude !== undefined && (typeof latitude !== "number" || !isFinite(latitude) || latitude < -90 || latitude > 90)) {
    return c.json({ error: "latitude must be a number between -90 and 90" }, 400);
  }
  if (longitude !== undefined && (typeof longitude !== "number" || !isFinite(longitude) || longitude < -180 || longitude > 180)) {
    return c.json({ error: "longitude must be a number between -180 and 180" }, 400);
  }
  if (weatherEnabled !== undefined && typeof weatherEnabled !== "boolean") {
    return c.json({ error: "weatherEnabled must be a boolean" }, 400);
  }
  if (timezone !== undefined && (typeof timezone !== "string" || !VALID_TIMEZONES.has(timezone))) {
    return c.json({ error: "Invalid timezone" }, 400);
  }

  // Validate tempUnit if provided
  if (tempUnit !== undefined && (typeof tempUnit !== "string" || !VALID_TEMP_UNITS.has(tempUnit))) {
    return c.json({ error: "tempUnit must be one of: auto, fahrenheit, celsius" }, 400);
  }
  if (backgroundStyle !== undefined) {
    const validStyles = ["photography", "abstract", "solid"];
    if (!validStyles.includes(backgroundStyle)) {
      return c.json({ error: "backgroundStyle must be 'photography', 'abstract', or 'solid'" }, 400);
    }
  }
  const pinnedBackground = body.pinnedBackground;
  if (pinnedBackground !== undefined) {
    // null clears the pin, string sets it (max 200 chars for safety)
    if (pinnedBackground !== null && (typeof pinnedBackground !== "string" || pinnedBackground.length > 200)) {
      return c.json({ error: "pinnedBackground must be a string (max 200 chars) or null" }, 400);
    }
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
  if (backgroundStyle !== undefined) data.backgroundStyle = backgroundStyle;
  if (pinnedBackground !== undefined) data.pinnedBackground = pinnedBackground;

  if (Object.keys(data).length === 0) {
    return c.json({ error: "No fields provided" }, 400);
  }

  // If location or timezone changed, invalidate weather cache
  const cacheInvalidated = city !== undefined || latitude !== undefined || longitude !== undefined || timezone !== undefined;
  if (cacheInvalidated) {
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
      backgroundStyle: true,
      pinnedBackground: true,
    },
  });

  return c.json(updated);
});

export { users };
