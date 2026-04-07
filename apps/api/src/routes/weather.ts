import { Hono } from "hono";
import { getConnInfo } from "@hono/node-server/conninfo";
import { authMiddleware, type AuthEnv } from "../middleware/auth.js";
import { rateLimiter } from "../middleware/rate-limit.js";
import { prisma } from "../lib/prisma.js";
import { resolveTempUnit, convertTemp } from "@brett/utils";
import type { WeatherCurrent, WeatherHourly, WeatherDaily, WeatherData } from "@brett/types";
import type { Prisma } from "@prisma/client";
import { fetchForecast, searchCities, geolocateIp } from "../services/weather.js";

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

const weather = new Hono<AuthEnv>();

// Auth on all routes
weather.use("*", authMiddleware);

// ── Helpers ──

function formatWeatherResponse(
  current: WeatherCurrent,
  hourly: WeatherHourly[],
  daily: WeatherDaily[],
  city: string,
  fetchedAt: Date,
  unit: "fahrenheit" | "celsius",
  isStale: boolean,
): { weather: WeatherData } {
  return {
    weather: {
      current: {
        ...current,
        temp: convertTemp(current.temp, unit),
        feelsLike: convertTemp(current.feelsLike, unit),
      },
      hourly: hourly.map((h) => ({
        ...h,
        temp: convertTemp(h.temp, unit),
      })),
      daily: daily.map((d) => ({
        ...d,
        high: convertTemp(d.high, unit),
        low: convertTemp(d.low, unit),
      })),
      city,
      fetchedAt: fetchedAt.toISOString(),
      isStale,
      unit,
    },
  };
}

// ── GET / — Current weather for the authenticated user ──

weather.get("/", rateLimiter(60), async (c) => {
  const userId = c.get("user").id;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      latitude: true,
      longitude: true,
      city: true,
      countryCode: true,
      timezone: true,
      tempUnit: true,
      weatherEnabled: true,
    },
  });

  if (!user || !user.weatherEnabled) {
    return c.json({ weather: null, reason: "disabled" });
  }

  let { latitude, longitude, city, countryCode } = user;
  const timezone = user.timezone ?? "America/Los_Angeles";

  // If no location, try IP geolocation
  if (latitude == null || longitude == null) {
    // In production (Railway), client IP is in X-Forwarded-For.
    // In local dev (no proxy), fall back to the raw connection address.
    const forwarded = c.req.header("x-forwarded-for");
    let ip = forwarded?.split(",")[0]?.trim();
    if (!ip) {
      try {
        const info = getConnInfo(c);
        ip = info.remote.address ?? undefined;
      } catch {
        // getConnInfo only works with @hono/node-server, not in tests
      }
    }

    if (ip) {
      const geo = await geolocateIp(ip);
      if (geo) {
        latitude = geo.latitude;
        longitude = geo.longitude;
        city = geo.name;
        countryCode = geo.countryCode;

        await prisma.user.update({
          where: { id: userId },
          data: {
            latitude: geo.latitude,
            longitude: geo.longitude,
            city: geo.name,
            countryCode: geo.countryCode,
          },
        });
      }
    }

    if (latitude == null || longitude == null) {
      return c.json({ weather: null, reason: "no_location" });
    }
  }

  const unit = resolveTempUnit(user.tempUnit, countryCode ?? undefined);
  const displayCity = city ?? "Unknown";

  // Check cache
  const cached = await prisma.weatherCache.findUnique({
    where: { userId },
  });

  if (cached && new Date() < cached.expiresAt) {
    if (!cached.current || !cached.hourly || !cached.daily) {
      // Cache corrupted — fall through to fetch fresh data
    } else {
      return c.json(
        formatWeatherResponse(
          cached.current as unknown as WeatherCurrent,
          cached.hourly as unknown as WeatherHourly[],
          cached.daily as unknown as WeatherDaily[],
          displayCity,
          cached.fetchedAt,
          unit,
          false,
        ),
      );
    }
  }

  // Fetch fresh data
  try {
    const forecast = await fetchForecast(latitude, longitude, timezone);
    const now = new Date();

    const currentJson = JSON.parse(JSON.stringify(forecast.current)) as Prisma.InputJsonValue;
    const hourlyJson = JSON.parse(JSON.stringify(forecast.hourly)) as Prisma.InputJsonValue;
    const dailyJson = JSON.parse(JSON.stringify(forecast.daily)) as Prisma.InputJsonValue;

    await prisma.weatherCache.upsert({
      where: { userId },
      create: {
        userId,
        current: currentJson,
        hourly: hourlyJson,
        daily: dailyJson,
        fetchedAt: now,
        expiresAt: new Date(now.getTime() + CACHE_TTL_MS),
      },
      update: {
        current: currentJson,
        hourly: hourlyJson,
        daily: dailyJson,
        fetchedAt: now,
        expiresAt: new Date(now.getTime() + CACHE_TTL_MS),
      },
    });

    return c.json(
      formatWeatherResponse(
        forecast.current,
        forecast.hourly,
        forecast.daily,
        displayCity,
        now,
        unit,
        false,
      ),
    );
  } catch (err) {
    console.error("Weather fetch failed:", err);

    // Serve stale cache if available and not corrupted
    if (cached && cached.current && cached.hourly && cached.daily) {
      return c.json(
        formatWeatherResponse(
          cached.current as unknown as WeatherCurrent,
          cached.hourly as unknown as WeatherHourly[],
          cached.daily as unknown as WeatherDaily[],
          displayCity,
          cached.fetchedAt,
          unit,
          true,
        ),
      );
    }

    return c.json({ weather: null, reason: "fetch_failed" });
  }
});

// ── GET /geocode — Search cities ──

weather.get("/geocode", rateLimiter(30), async (c) => {
  const query = c.req.query("q");

  if (!query || query.length < 2 || query.length > 100) {
    return c.json({ error: "Query must be 2-100 characters" }, 400);
  }

  const results = await searchCities(query);
  return c.json({ results });
});

export { weather };
