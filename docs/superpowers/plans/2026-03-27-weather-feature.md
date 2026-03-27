# Weather Feature Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add current weather to the Omnibar with expandable hourly + weekly forecast, server-side caching via Open-Meteo, and weather-aware daily briefings.

**Architecture:** Server-side weather fetching from Open-Meteo (free, no API key) cached per-user in Postgres with 1-hour TTL. IP-based auto-detection for initial location. Weather pill embedded in Omnibar input bar; click to expand hourly + 7-day view. Briefing prompt receives today's weather only when notable.

**Tech Stack:** Open-Meteo API (forecast + geocoding), ip-api.com (IP geolocation), Prisma (schema + cache), Hono (API routes), React + TanStack Query (desktop hooks), Tailwind (UI)

**Spec:** `docs/superpowers/specs/2026-03-27-weather-feature-design.md`

---

## File Map

### New Files

| File | Responsibility |
|------|---------------|
| `packages/types/src/weather.ts` | Shared weather types (WeatherData, HourlyForecast, DailyForecast, GeocodingResult, LocationSettings) |
| `apps/api/src/services/weather.ts` | Open-Meteo client (forecast + geocoding), IP geolocation, weather code → condition mapping |
| `apps/api/src/routes/weather.ts` | `GET /weather` route with caching logic |
| `apps/api/src/__tests__/weather.test.ts` | API tests for weather routes |
| `apps/desktop/src/api/weather.ts` | `useWeather()` hook — fetch + cache weather data for Omnibar |
| `apps/desktop/src/api/location.ts` | `useLocationSettings()` hook — city search + save location |
| `apps/desktop/src/settings/LocationSection.tsx` | Settings UI: weather toggle, city search, temp unit picker |
| `packages/ui/src/WeatherPill.tsx` | Collapsed weather pill (icon + temp) |
| `packages/ui/src/WeatherExpanded.tsx` | Expanded weather view (current + hourly + weekly) |

### Modified Files

| File | Changes |
|------|---------|
| `apps/api/prisma/schema.prisma` | Add User fields (city, latitude, longitude, countryCode, tempUnit, weatherEnabled) + WeatherCache model |
| `packages/types/src/index.ts` | Re-export weather types |
| `apps/api/src/app.ts` | Mount weather routes |
| `apps/api/src/routes/users.ts` | Update `GET /me` to return weather fields; add `PATCH /users/location` |
| `packages/ai/src/context/system-prompts.ts` | Add weather instruction to BRIEFING_SYSTEM_PROMPT |
| `packages/ai/src/context/assembler.ts` | Inject weather context into briefing assembly |
| `packages/utils/src/weather.ts` | Move `resolveTempUnit` and `convertTemp` to shared package (used by API + AI) |
| `packages/ui/src/Omnibar.tsx` | Add WeatherPill to input bar, WeatherExpanded to content area |
| `apps/api/src/routes/users.ts` | Also invalidate weather cache on timezone change in existing `PATCH /users/timezone` |
| `apps/desktop/src/settings/SettingsPage.tsx` | Add LocationSection |

---

## Task 1: Schema & Migration

**Files:**
- Modify: `apps/api/prisma/schema.prisma`

- [ ] **Step 1: Add weather fields to User model**

In `schema.prisma`, add to the User model after the `timezoneAuto` field:

```prisma
  city            String?
  countryCode     String?   // ISO 3166-1 alpha-2, e.g. "US" — for resolving tempUnit "auto"
  latitude        Float?
  longitude       Float?
  tempUnit        String   @default("auto")
  weatherEnabled  Boolean  @default(true)
```

- [ ] **Step 2: Add WeatherCache model**

Add after the existing models in `schema.prisma`:

```prisma
model WeatherCache {
  id        String   @id @default(cuid())
  userId    String   @unique
  fetchedAt DateTime
  expiresAt DateTime
  current   Json
  hourly    Json
  daily     Json

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
}
```

Also add `weatherCache WeatherCache?` to the User model's relations.

- [ ] **Step 3: Generate and run migration**

```bash
cd apps/api && npx prisma migrate dev --name add-weather-cache
```

- [ ] **Step 4: Verify migration applied**

```bash
cd apps/api && npx prisma migrate status
```

Expected: all migrations applied.

- [ ] **Step 5: Commit**

```bash
git add apps/api/prisma/
git commit -m "feat(weather): add weather fields to User + WeatherCache table"
```

---

## Task 2: Shared Weather Types

**Files:**
- Create: `packages/types/src/weather.ts`
- Modify: `packages/types/src/index.ts`

- [ ] **Step 1: Create weather types**

Create `packages/types/src/weather.ts`:

```typescript
export interface WeatherCurrent {
  temp: number;
  feelsLike: number;
  conditionCode: number;
  condition: string;
  humidity: number;
  windSpeed: number;
  icon: string;
}

export interface WeatherHourly {
  hour: string; // ISO timestamp
  temp: number;
  conditionCode: number;
  icon: string;
  precipProb: number;
}

export interface WeatherDaily {
  date: string; // YYYY-MM-DD
  high: number;
  low: number;
  conditionCode: number;
  icon: string;
  precipProb: number;
}

export interface WeatherData {
  current: WeatherCurrent;
  hourly: WeatherHourly[];
  daily: WeatherDaily[];
  city: string;
  fetchedAt: string; // ISO timestamp
  isStale: boolean;
}

export interface GeocodingResult {
  name: string;
  state?: string;
  country: string;
  countryCode: string;
  latitude: number;
  longitude: number;
  timezone: string;
  displayName: string; // "City, State, Country" formatted
}

export interface LocationSettings {
  city: string | null;
  latitude: number | null;
  longitude: number | null;
  tempUnit: "auto" | "fahrenheit" | "celsius";
  weatherEnabled: boolean;
}
```

- [ ] **Step 2: Re-export from index**

In `packages/types/src/index.ts`, add at the bottom:

```typescript
export type {
  WeatherCurrent,
  WeatherHourly,
  WeatherDaily,
  WeatherData,
  GeocodingResult,
  LocationSettings,
} from "./weather.js";
```

- [ ] **Step 3: Typecheck**

```bash
pnpm typecheck
```

- [ ] **Step 4: Commit**

```bash
git add packages/types/
git commit -m "feat(weather): add shared weather types"
```

---

## Task 3: Weather Service (Open-Meteo + IP Geolocation)

**Files:**
- Create: `apps/api/src/services/weather.ts`

- [ ] **Step 1: Write the weather code → condition mapping**

The Open-Meteo API returns WMO weather codes (0-99). Create the service file with the mapping and helper functions:

```typescript
import type { WeatherCurrent, WeatherHourly, WeatherDaily } from "@brett/types";

// WMO Weather interpretation codes → condition + emoji
const WMO_CODES: Record<number, { condition: string; icon: string }> = {
  0: { condition: "Clear sky", icon: "☀️" },
  1: { condition: "Mainly clear", icon: "🌤️" },
  2: { condition: "Partly cloudy", icon: "⛅" },
  3: { condition: "Overcast", icon: "☁️" },
  45: { condition: "Fog", icon: "🌫️" },
  48: { condition: "Rime fog", icon: "🌫️" },
  51: { condition: "Light drizzle", icon: "🌦️" },
  53: { condition: "Moderate drizzle", icon: "🌦️" },
  55: { condition: "Dense drizzle", icon: "🌦️" },
  56: { condition: "Light freezing drizzle", icon: "🌧️" },
  57: { condition: "Dense freezing drizzle", icon: "🌧️" },
  61: { condition: "Slight rain", icon: "🌧️" },
  63: { condition: "Moderate rain", icon: "🌧️" },
  65: { condition: "Heavy rain", icon: "🌧️" },
  66: { condition: "Light freezing rain", icon: "🌧️" },
  67: { condition: "Heavy freezing rain", icon: "🌧️" },
  71: { condition: "Slight snow", icon: "🌨️" },
  73: { condition: "Moderate snow", icon: "🌨️" },
  75: { condition: "Heavy snow", icon: "🌨️" },
  77: { condition: "Snow grains", icon: "🌨️" },
  80: { condition: "Slight showers", icon: "🌦️" },
  81: { condition: "Moderate showers", icon: "🌧️" },
  82: { condition: "Violent showers", icon: "🌧️" },
  85: { condition: "Slight snow showers", icon: "🌨️" },
  86: { condition: "Heavy snow showers", icon: "🌨️" },
  95: { condition: "Thunderstorm", icon: "⛈️" },
  96: { condition: "Thunderstorm with hail", icon: "⛈️" },
  99: { condition: "Thunderstorm with heavy hail", icon: "⛈️" },
};

function getCondition(code: number): { condition: string; icon: string } {
  return WMO_CODES[code] ?? { condition: "Unknown", icon: "🌡️" };
}
```

- [ ] **Step 2: Add Open-Meteo forecast fetcher**

Add to the same file:

```typescript
interface OpenMeteoForecastResponse {
  current: {
    temperature_2m: number;
    apparent_temperature: number;
    weather_code: number;
    relative_humidity_2m: number;
    wind_speed_10m: number;
  };
  hourly: {
    time: string[];
    temperature_2m: number[];
    weather_code: number[];
    precipitation_probability: number[];
  };
  daily: {
    time: string[];
    temperature_2m_max: number[];
    temperature_2m_min: number[];
    weather_code: number[];
    precipitation_probability_max: number[];
  };
}

export async function fetchForecast(
  latitude: number,
  longitude: number,
  timezone: string
): Promise<{ current: WeatherCurrent; hourly: WeatherHourly[]; daily: WeatherDaily[] }> {
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    timezone,
    current: "temperature_2m,apparent_temperature,weather_code,relative_humidity_2m,wind_speed_10m",
    hourly: "temperature_2m,weather_code,precipitation_probability",
    daily: "temperature_2m_max,temperature_2m_min,weather_code,precipitation_probability_max",
    forecast_days: "7",
  });

  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
  if (!res.ok) throw new Error(`Open-Meteo forecast failed: ${res.status}`);
  const data: OpenMeteoForecastResponse = await res.json();

  const { condition, icon } = getCondition(data.current.weather_code);
  const current: WeatherCurrent = {
    temp: Math.round(data.current.temperature_2m),
    feelsLike: Math.round(data.current.apparent_temperature),
    conditionCode: data.current.weather_code,
    condition,
    humidity: data.current.relative_humidity_2m,
    windSpeed: Math.round(data.current.wind_speed_10m),
    icon,
  };

  const hourly: WeatherHourly[] = data.hourly.time.map((time, i) => {
    const c = getCondition(data.hourly.weather_code[i]);
    return {
      hour: time,
      temp: Math.round(data.hourly.temperature_2m[i]),
      conditionCode: data.hourly.weather_code[i],
      icon: c.icon,
      precipProb: data.hourly.precipitation_probability[i],
    };
  });

  const daily: WeatherDaily[] = data.daily.time.map((date, i) => {
    const c = getCondition(data.daily.weather_code[i]);
    return {
      date,
      high: Math.round(data.daily.temperature_2m_max[i]),
      low: Math.round(data.daily.temperature_2m_min[i]),
      conditionCode: data.daily.weather_code[i],
      icon: c.icon,
      precipProb: data.daily.precipitation_probability_max[i],
    };
  });

  return { current, hourly, daily };
}
```

- [ ] **Step 3: Add geocoding search**

```typescript
import type { GeocodingResult } from "@brett/types";

interface OpenMeteoGeoResult {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  country: string;
  country_code: string;
  admin1?: string; // state/region
  timezone: string;
}

export async function searchCities(query: string): Promise<GeocodingResult[]> {
  const params = new URLSearchParams({ name: query, count: "8", language: "en" });
  const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?${params}`);
  if (!res.ok) throw new Error(`Open-Meteo geocoding failed: ${res.status}`);
  const data = await res.json();

  if (!data.results) return [];

  return (data.results as OpenMeteoGeoResult[]).map((r) => ({
    name: r.name,
    state: r.admin1,
    country: r.country,
    countryCode: r.country_code,
    latitude: r.latitude,
    longitude: r.longitude,
    timezone: r.timezone,
    displayName: [r.name, r.admin1, r.country].filter(Boolean).join(", "),
  }));
}
```

- [ ] **Step 4: Add IP geolocation**

```typescript
interface IpApiResponse {
  status: string;
  city: string;
  regionName: string;
  country: string;
  countryCode: string;
  lat: number;
  lon: number;
  timezone: string;
}

export async function geolocateIp(ip: string): Promise<GeocodingResult | null> {
  try {
    // ip-api.com free tier: HTTP only, 45 req/min, non-commercial
    const res = await fetch(`http://ip-api.com/json/${ip}?fields=status,city,regionName,country,countryCode,lat,lon,timezone`);
    if (!res.ok) return null;
    const data: IpApiResponse = await res.json();
    if (data.status !== "success") return null;

    return {
      name: data.city,
      state: data.regionName,
      country: data.country,
      countryCode: data.countryCode,
      latitude: data.lat,
      longitude: data.lon,
      timezone: data.timezone,
      displayName: [data.city, data.regionName, data.country].filter(Boolean).join(", "),
    };
  } catch {
    return null;
  }
}
```

- [ ] **Step 5: Add temperature unit helpers to @brett/utils**

These are pure functions shared by both `apps/api` and `packages/ai`, so they go in the shared utils package. Add to `packages/utils/src/weather.ts`:

```typescript
const FAHRENHEIT_COUNTRIES = new Set(["US", "LR", "MM"]);

export function resolveTempUnit(
  tempUnit: string,
  countryCode?: string
): "fahrenheit" | "celsius" {
  if (tempUnit === "fahrenheit") return "fahrenheit";
  if (tempUnit === "celsius") return "celsius";
  // "auto" — derive from country
  return countryCode && FAHRENHEIT_COUNTRIES.has(countryCode) ? "fahrenheit" : "celsius";
}

/** Convert Celsius to the target unit. All cached temps are stored as Celsius. */
export function convertTemp(celsius: number, unit: "fahrenheit" | "celsius"): number {
  if (unit === "fahrenheit") return Math.round(celsius * 9 / 5 + 32);
  return celsius;
}
```

Re-export from `packages/utils/src/index.ts`:

```typescript
export { resolveTempUnit, convertTemp } from "./weather.js";
```

- [ ] **Step 6: Typecheck**

```bash
pnpm typecheck
```

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/services/weather.ts
git commit -m "feat(weather): add Open-Meteo client, geocoding, and IP geolocation service"
```

---

## Task 4: API Routes (Weather + User Location)

**Files:**
- Create: `apps/api/src/routes/weather.ts`
- Modify: `apps/api/src/routes/users.ts`
- Modify: `apps/api/src/app.ts`

- [ ] **Step 1: Create weather route**

Create `apps/api/src/routes/weather.ts`:

```typescript
import { Hono } from "hono";
import type { AuthEnv } from "../middleware/auth.js";
import { authMiddleware } from "../middleware/auth.js";
import { rateLimiter } from "../middleware/rate-limit.js";
import { prisma } from "../lib/prisma.js";
import { fetchForecast, geolocateIp, searchCities } from "../services/weather.js";
import { resolveTempUnit, convertTemp } from "@brett/utils";
import type { WeatherData, WeatherCurrent, WeatherHourly, WeatherDaily } from "@brett/types";

const weather = new Hono<AuthEnv>();

weather.use("*", authMiddleware);

// GET /weather — returns current + hourly + daily, cached with 1hr TTL
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
    return c.json({ weather: null, reason: "disabled" }, 200);
  }

  let { latitude, longitude, city } = user;
  let countryCode: string | undefined = user.countryCode ?? undefined;

  // Auto-detect location from IP if not set
  if (latitude == null || longitude == null) {
    const forwarded = c.req.header("x-forwarded-for");
    const ip = forwarded?.split(",")[0]?.trim() ?? "";
    if (!ip) return c.json({ weather: null, reason: "no_location" }, 200);

    const geo = await geolocateIp(ip);
    if (!geo) return c.json({ weather: null, reason: "no_location" }, 200);

    // Save detected location + country code to user record
    await prisma.user.update({
      where: { id: userId },
      data: {
        city: geo.displayName,
        latitude: geo.latitude,
        longitude: geo.longitude,
        countryCode: geo.countryCode,
      },
    });

    latitude = geo.latitude;
    longitude = geo.longitude;
    city = geo.displayName;
    countryCode = geo.countryCode;
  }

  // Check cache
  const cached = await prisma.weatherCache.findUnique({ where: { userId } });
  const now = new Date();

  if (cached && cached.expiresAt > now) {
    const unit = resolveTempUnit(user.tempUnit, countryCode);
    return c.json({
      weather: formatWeatherResponse(
        cached.current as WeatherCurrent,
        cached.hourly as WeatherHourly[],
        cached.daily as WeatherDaily[],
        city ?? "",
        cached.fetchedAt.toISOString(),
        false,
        unit
      ),
    });
  }

  // Fetch fresh data
  try {
    const forecast = await fetchForecast(latitude, longitude, user.timezone);

    // Upsert cache
    await prisma.weatherCache.upsert({
      where: { userId },
      create: {
        userId,
        fetchedAt: now,
        expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
        current: forecast.current as any,
        hourly: forecast.hourly as any,
        daily: forecast.daily as any,
      },
      update: {
        fetchedAt: now,
        expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
        current: forecast.current as any,
        hourly: forecast.hourly as any,
        daily: forecast.daily as any,
      },
    });

    const unit = resolveTempUnit(user.tempUnit, countryCode);
    return c.json({
      weather: formatWeatherResponse(
        forecast.current,
        forecast.hourly,
        forecast.daily,
        city ?? "",
        now.toISOString(),
        false,
        unit
      ),
    });
  } catch {
    // Serve stale cache if available
    if (cached) {
      const unit = resolveTempUnit(user.tempUnit, countryCode);
      return c.json({
        weather: formatWeatherResponse(
          cached.current as WeatherCurrent,
          cached.hourly as WeatherHourly[],
          cached.daily as WeatherDaily[],
          city ?? "",
          cached.fetchedAt.toISOString(),
          true,
          unit
        ),
      });
    }
    return c.json({ weather: null, reason: "fetch_failed" }, 200);
  }
});

function formatWeatherResponse(
  current: WeatherCurrent,
  hourly: WeatherHourly[],
  daily: WeatherDaily[],
  city: string,
  fetchedAt: string,
  isStale: boolean,
  unit: "fahrenheit" | "celsius"
): WeatherData {
  const convert = (t: number) => convertTemp(t, unit);
  return {
    current: { ...current, temp: convert(current.temp), feelsLike: convert(current.feelsLike) },
    hourly: hourly.map((h) => ({ ...h, temp: convert(h.temp) })),
    daily: daily.map((d) => ({ ...d, high: convert(d.high), low: convert(d.low) })),
    city,
    fetchedAt,
    isStale,
  };
}

export { weather };
```

- [ ] **Step 2: Update users.ts — add weather fields to GET /me**

In `apps/api/src/routes/users.ts`, update the `GET /` (which serves as `/users/me`) handler's Prisma select to include:

```typescript
select: {
  // existing fields...
  timezone: true,
  timezoneAuto: true,
  // add these:
  city: true,
  countryCode: true,
  latitude: true,
  longitude: true,
  tempUnit: true,
  weatherEnabled: true,
},
```

And include them in the response object.

- [ ] **Step 3: Add PATCH /users/location to users.ts**

Add a new route in `users.ts`:

```typescript
// PATCH /users/location — update weather location preferences
users.patch("/location", authMiddleware, async (c) => {
  const userId = c.get("user").id;
  const body = await c.req.json();
  const { city, latitude, longitude, countryCode, tempUnit, weatherEnabled, timezone } = body;

  const data: Record<string, unknown> = {};
  if (city !== undefined) data.city = city;
  if (countryCode !== undefined) data.countryCode = countryCode;
  if (latitude !== undefined) data.latitude = latitude;
  if (longitude !== undefined) data.longitude = longitude;
  if (tempUnit !== undefined) {
    if (!["auto", "fahrenheit", "celsius"].includes(tempUnit)) {
      return c.json({ error: "Invalid tempUnit" }, 400);
    }
    data.tempUnit = tempUnit;
  }
  if (weatherEnabled !== undefined) data.weatherEnabled = Boolean(weatherEnabled);
  if (timezone !== undefined) data.timezone = timezone;

  if (Object.keys(data).length === 0) {
    return c.json({ error: "No fields to update" }, 400);
  }

  // Invalidate weather cache if location changed
  const locationChanged = city !== undefined || latitude !== undefined || longitude !== undefined;
  if (locationChanged) {
    await prisma.weatherCache.deleteMany({ where: { userId } });
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data,
    select: { city: true, latitude: true, longitude: true, tempUnit: true, weatherEnabled: true, timezone: true },
  });

  return c.json(updated);
});
```

- [ ] **Step 4: Mount weather routes in app.ts**

In `apps/api/src/app.ts`, import and mount:

```typescript
import { weather } from "./routes/weather.js";
// ...
app.route("/weather", weather);
```

- [ ] **Step 5: Invalidate weather cache on timezone change**

In the existing `PATCH /users/timezone` handler in `apps/api/src/routes/users.ts`, add weather cache invalidation after the user update:

```typescript
// After the prisma.user.update() call:
await prisma.weatherCache.deleteMany({ where: { userId } });
```

This ensures hourly forecasts (which use the user's timezone) are refreshed when timezone changes.

- [ ] **Step 6: Add geocoding search endpoint to weather.ts**

Add below the `GET /` handler in `apps/api/src/routes/weather.ts` (the `searchCities` import was already added in Step 1):

```typescript
// GET /weather/geocode?q=... — search cities for settings dropdown
weather.get("/geocode", rateLimiter(30), async (c) => {
  const query = c.req.query("q");
  if (!query || query.length < 2) return c.json({ results: [] });

  const results = await searchCities(query);
  return c.json({ results });
});
```

- [ ] **Step 7: Typecheck**

```bash
pnpm typecheck
```

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/routes/weather.ts apps/api/src/routes/users.ts apps/api/src/app.ts
git commit -m "feat(weather): add weather API routes, location PATCH, geocoding endpoint"
```

---

## Task 5: API Tests

**Files:**
- Create: `apps/api/src/__tests__/weather.test.ts`

- [ ] **Step 1: Write tests for weather routes**

Follow the existing test pattern from `auth.test.ts` — use `app.request()` with `authRequest()` helper.

```typescript
import { describe, it, expect, beforeAll } from "vitest";
import { app } from "../app.js";
import { createTestUser, authRequest } from "./helpers.js";
import { prisma } from "../lib/prisma.js";

describe("Weather routes", () => {
  let token: string;
  let userId: string;

  beforeAll(async () => {
    const user = await createTestUser("weather-test");
    token = user.token;
    userId = user.userId;
  });

  describe("GET /weather", () => {
    it("returns null weather when no location is set and no IP", async () => {
      const res = await authRequest("/weather", token);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.weather).toBeNull();
      expect(body.reason).toBe("no_location");
    });

    it("returns null when weather is disabled", async () => {
      await prisma.user.update({
        where: { id: userId },
        data: { weatherEnabled: false },
      });
      const res = await authRequest("/weather", token);
      const body = await res.json();
      expect(body.weather).toBeNull();
      expect(body.reason).toBe("disabled");

      // Restore
      await prisma.user.update({
        where: { id: userId },
        data: { weatherEnabled: true },
      });
    });

    it("returns weather data when location is set", async () => {
      // Set location to a known city
      await prisma.user.update({
        where: { id: userId },
        data: {
          city: "San Francisco, California, US",
          latitude: 37.7749,
          longitude: -122.4194,
        },
      });

      const res = await authRequest("/weather", token);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.weather).toBeDefined();
      expect(body.weather.current).toBeDefined();
      expect(body.weather.current.temp).toBeTypeOf("number");
      expect(body.weather.hourly).toBeInstanceOf(Array);
      expect(body.weather.daily).toBeInstanceOf(Array);
      expect(body.weather.city).toBe("San Francisco, California, US");
    });

    it("returns cached data on subsequent requests", async () => {
      const res1 = await authRequest("/weather", token);
      const body1 = await res1.json();

      const res2 = await authRequest("/weather", token);
      const body2 = await res2.json();

      expect(body1.weather.fetchedAt).toBe(body2.weather.fetchedAt);
    });
  });

  describe("GET /weather/geocode", () => {
    it("returns empty for short queries", async () => {
      const res = await authRequest("/weather/geocode?q=a", token);
      const body = await res.json();
      expect(body.results).toEqual([]);
    });

    it("returns results for valid city search", async () => {
      const res = await authRequest("/weather/geocode?q=San Francisco", token);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.results.length).toBeGreaterThan(0);
      expect(body.results[0]).toHaveProperty("displayName");
      expect(body.results[0]).toHaveProperty("latitude");
      expect(body.results[0]).toHaveProperty("longitude");
      expect(body.results[0]).toHaveProperty("timezone");
    });
  });

  describe("PATCH /users/location", () => {
    it("updates location fields", async () => {
      const res = await authRequest("/users/location", token, {
        method: "PATCH",
        body: JSON.stringify({
          city: "New York, New York, US",
          latitude: 40.7128,
          longitude: -74.006,
        }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.city).toBe("New York, New York, US");
    });

    it("invalidates weather cache on location change", async () => {
      // Ensure cache exists
      await authRequest("/weather", token);
      const cached = await prisma.weatherCache.findUnique({ where: { userId } });
      expect(cached).toBeDefined();

      // Change location
      await authRequest("/users/location", token, {
        method: "PATCH",
        body: JSON.stringify({ city: "London, UK", latitude: 51.5074, longitude: -0.1278 }),
      });

      const afterChange = await prisma.weatherCache.findUnique({ where: { userId } });
      expect(afterChange).toBeNull();
    });

    it("rejects invalid tempUnit", async () => {
      const res = await authRequest("/users/location", token, {
        method: "PATCH",
        body: JSON.stringify({ tempUnit: "kelvin" }),
      });
      expect(res.status).toBe(400);
    });

    it("allows updating weatherEnabled independently", async () => {
      const res = await authRequest("/users/location", token, {
        method: "PATCH",
        body: JSON.stringify({ weatherEnabled: false }),
      });
      expect(res.status).toBe(200);
      expect(res.json()).resolves.toMatchObject({ weatherEnabled: false });
    });
  });
});
```

- [ ] **Step 2: Run tests**

```bash
cd apps/api && pnpm test
```

Expected: all weather tests pass.

**Note:** These integration tests hit real Open-Meteo and ip-api.com APIs (free, no key). They require network access and may be flaky if external services are down. If running in CI without network, tag these tests or skip them. For now, acceptable as integration tests since the external APIs are free and reliable.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/__tests__/weather.test.ts
git commit -m "test(weather): add API tests for weather routes, geocoding, and location"
```

---

## Task 6: Desktop Hooks

**Files:**
- Create: `apps/desktop/src/api/weather.ts`
- Create: `apps/desktop/src/api/location.ts`

- [ ] **Step 1: Create weather hook**

Create `apps/desktop/src/api/weather.ts`:

```typescript
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "./client";
import type { WeatherData } from "@brett/types";

interface WeatherResponse {
  weather: WeatherData | null;
  reason?: string;
}

export function useWeather(enabled: boolean = true) {
  const query = useQuery({
    queryKey: ["weather"],
    queryFn: () => apiFetch<WeatherResponse>("/weather"),
    enabled,
    staleTime: 5 * 60 * 1000, // 5 min client-side staleness (server caches 1hr)
    refetchInterval: 15 * 60 * 1000, // Refetch every 15 min
    refetchOnWindowFocus: false,
  });

  return {
    weather: query.data?.weather ?? null,
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}
```

- [ ] **Step 2: Create location hook**

Create `apps/desktop/src/api/location.ts`:

```typescript
import { useState, useCallback } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { apiFetch } from "./client";
import type { GeocodingResult, LocationSettings } from "@brett/types";

export function useLocationSettings() {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (data: Partial<LocationSettings> & { timezone?: string }) =>
      apiFetch("/users/location", { method: "PATCH", body: JSON.stringify(data) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["user-me"] });
      queryClient.invalidateQueries({ queryKey: ["weather"] });
    },
  });

  return {
    updateLocation: mutation.mutateAsync,
    isSaving: mutation.isPending,
  };
}

export function useCitySearch() {
  const [query, setQuery] = useState("");

  const search = useQuery({
    queryKey: ["city-search", query],
    queryFn: () =>
      apiFetch<{ results: GeocodingResult[] }>(`/weather/geocode?q=${encodeURIComponent(query)}`),
    enabled: query.length >= 2,
    staleTime: 60 * 1000,
  });

  return {
    query,
    setQuery,
    results: search.data?.results ?? [],
    isSearching: search.isFetching,
  };
}
```

- [ ] **Step 3: Typecheck**

```bash
pnpm typecheck
```

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/api/weather.ts apps/desktop/src/api/location.ts
git commit -m "feat(weather): add desktop hooks for weather data and location settings"
```

---

## Task 7: Settings — LocationSection

**Files:**
- Create: `apps/desktop/src/settings/LocationSection.tsx`
- Modify: `apps/desktop/src/settings/SettingsPage.tsx`

- [ ] **Step 1: Create LocationSection**

Create `apps/desktop/src/settings/LocationSection.tsx`. Follow the same patterns as `TimezoneSection.tsx` — fetches user data from `["user-me"]`, shows saving/saved feedback, uses glass morphism styling.

```typescript
import React, { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { MapPin, Search, Check, AlertCircle } from "lucide-react";
import { apiFetch } from "../api/client";
import { useLocationSettings, useCitySearch } from "../api/location";
import type { GeocodingResult } from "@brett/types";

export function LocationSection() {
  const { data: user } = useQuery({
    queryKey: ["user-me"],
    queryFn: () => apiFetch<any>("/users/me"),
  });

  const { updateLocation, isSaving } = useLocationSettings();
  const { query, setQuery, results, isSearching } = useCitySearch();
  const [showDropdown, setShowDropdown] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const weatherEnabled = user?.weatherEnabled ?? true;
  const currentCity = user?.city ?? null;
  const currentTempUnit = user?.tempUnit ?? "auto";

  // Close dropdown on click outside
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const handleCitySelect = async (result: GeocodingResult) => {
    setShowDropdown(false);
    setQuery("");
    setError(null);
    try {
      const data: Record<string, unknown> = {
        city: result.displayName,
        latitude: result.latitude,
        longitude: result.longitude,
        countryCode: result.countryCode,
      };
      // Sync timezone if auto-detect is off
      if (user && !user.timezoneAuto) {
        data.timezone = result.timezone;
      }
      await updateLocation(data);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      setError("Failed to save location");
      setTimeout(() => setError(null), 4000);
    }
  };

  const handleToggleWeather = async () => {
    try {
      await updateLocation({ weatherEnabled: !weatherEnabled });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      setError("Failed to update");
      setTimeout(() => setError(null), 4000);
    }
  };

  const handleTempUnitChange = async (unit: string) => {
    try {
      await updateLocation({ tempUnit: unit as "auto" | "fahrenheit" | "celsius" });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      setError("Failed to update");
      setTimeout(() => setError(null), 4000);
    }
  };

  return (
    <div id="location-settings" className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-mono text-xs uppercase tracking-wider text-white/40">
          Weather & Location
        </h3>
        {saved && <Check size={14} className="text-green-400" />}
        {error && (
          <span className="flex items-center gap-1 text-xs text-red-400">
            <AlertCircle size={12} /> {error}
          </span>
        )}
      </div>

      {/* Weather toggle */}
      <div className="flex items-center justify-between">
        <span className="text-sm text-white/80">Show weather</span>
        <button
          onClick={handleToggleWeather}
          disabled={isSaving}
          className={`relative w-10 h-5 rounded-full transition-colors ${
            weatherEnabled ? "bg-blue-500" : "bg-white/10"
          }`}
        >
          <div
            className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
              weatherEnabled ? "translate-x-5" : "translate-x-0.5"
            }`}
          />
        </button>
      </div>

      {weatherEnabled && (
        <>
          {/* City search */}
          <div className="relative" ref={dropdownRef}>
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/5 border border-white/[0.03] focus-within:border-white/10 transition-colors">
              <MapPin size={14} className="text-white/30 flex-shrink-0" />
              <input
                type="text"
                placeholder={currentCity ?? "Search city..."}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setShowDropdown(true);
                }}
                onFocus={() => query.length >= 2 && setShowDropdown(true)}
                className="flex-1 bg-transparent text-sm text-white/80 placeholder:text-white/30 outline-none"
              />
              {isSearching && (
                <div className="w-3 h-3 border border-white/30 border-t-white/80 rounded-full animate-spin" />
              )}
            </div>

            {/* Dropdown results */}
            {showDropdown && results.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-1 z-50 bg-black/60 backdrop-blur-2xl border border-white/10 rounded-xl overflow-hidden shadow-xl max-h-48 overflow-y-auto">
                {results.map((r, i) => (
                  <button
                    key={`${r.latitude}-${r.longitude}-${i}`}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left text-white/70 hover:bg-white/10 transition-colors"
                    onClick={() => handleCitySelect(r)}
                  >
                    <MapPin size={12} className="text-white/30 flex-shrink-0" />
                    <span className="truncate">{r.displayName}</span>
                  </button>
                ))}
              </div>
            )}

            {currentCity && !query && (
              <p className="mt-1 text-[10px] text-white/30">
                {user?.latitude && !user?.city?.includes("(detected")
                  ? currentCity
                  : `${currentCity} (detected from IP)`}
              </p>
            )}
          </div>

          {/* Temperature unit */}
          <div className="flex items-center justify-between">
            <span className="text-sm text-white/80">Temperature unit</span>
            <select
              value={currentTempUnit}
              onChange={(e) => handleTempUnitChange(e.target.value)}
              className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white/80 outline-none cursor-pointer"
            >
              <option value="auto">Auto (from locale)</option>
              <option value="fahrenheit">Fahrenheit (°F)</option>
              <option value="celsius">Celsius (°C)</option>
            </select>
          </div>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add LocationSection to SettingsPage**

In `apps/desktop/src/settings/SettingsPage.tsx`, import and add `<LocationSection />` after the Timezone section (before Briefing):

```typescript
import { LocationSection } from "./LocationSection";
// ...
// After <TimezoneSection />:
<LocationSection />
```

- [ ] **Step 3: Typecheck**

```bash
pnpm typecheck
```

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/settings/LocationSection.tsx apps/desktop/src/settings/SettingsPage.tsx
git commit -m "feat(weather): add location settings section with city search"
```

---

## Task 8: Weather UI Components

**Files:**
- Create: `packages/ui/src/WeatherPill.tsx`
- Create: `packages/ui/src/WeatherExpanded.tsx`

- [ ] **Step 1: Create WeatherPill component**

Create `packages/ui/src/WeatherPill.tsx`:

```typescript
import React from "react";
import type { WeatherCurrent } from "@brett/types";

interface WeatherPillProps {
  current: WeatherCurrent;
  isActive: boolean;
  onClick: () => void;
}

export function WeatherPill({ current, isActive, onClick }: WeatherPillProps) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full transition-colors flex-shrink-0 ${
        isActive
          ? "bg-blue-500/10 border border-blue-500/30"
          : "bg-white/5 border border-white/[0.08] hover:bg-white/10"
      }`}
      title="Weather"
    >
      <span className="text-[15px] leading-none">{current.icon}</span>
      <span className="text-[13px] font-medium text-white/80">{current.temp}°</span>
    </button>
  );
}

export function WeatherPillSkeleton() {
  return (
    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/5 border border-white/[0.08] flex-shrink-0 animate-pulse">
      <div className="w-4 h-4 rounded bg-white/10" />
      <div className="w-6 h-3 rounded bg-white/10" />
    </div>
  );
}
```

- [ ] **Step 2: Create WeatherExpanded component**

Create `packages/ui/src/WeatherExpanded.tsx`:

```typescript
import React, { useRef, useEffect } from "react";
import type { WeatherData } from "@brett/types";

interface WeatherExpandedProps {
  weather: WeatherData;
}

export function WeatherExpanded({ weather }: WeatherExpandedProps) {
  const hourlyRef = useRef<HTMLDivElement>(null);

  // Find the "now" hour index — closest hour to current time
  const now = new Date();
  const nowHourIdx = weather.hourly.findIndex((h) => new Date(h.hour) >= now);
  const visibleHours = weather.hourly.slice(
    Math.max(0, nowHourIdx),
    Math.min(weather.hourly.length, nowHourIdx + 12)
  );

  // Auto-scroll to "now" on mount
  useEffect(() => {
    hourlyRef.current?.scrollTo({ left: 0 });
  }, []);

  // Compute temp range across the week for bar positioning
  const weekMin = Math.min(...weather.daily.map((d) => d.low));
  const weekMax = Math.max(...weather.daily.map((d) => d.high));
  const weekRange = weekMax - weekMin || 1;

  const today = new Date().toISOString().split("T")[0];
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  const formatHour = (iso: string) => {
    const d = new Date(iso);
    const h = d.getHours();
    if (h === 0) return "12am";
    if (h === 12) return "12pm";
    return h > 12 ? `${h - 12}pm` : `${h}am`;
  };

  const getDayLabel = (dateStr: string) => {
    if (dateStr === today) return "Today";
    const d = new Date(dateStr + "T12:00:00");
    return dayNames[d.getDay()];
  };

  return (
    <div className="p-4">
      {/* Current conditions */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <span className="text-[32px] leading-none">{weather.current.icon}</span>
          <div>
            <div className="text-[28px] font-semibold text-white/95 leading-none">
              {weather.current.temp}°
            </div>
            <div className="text-xs text-white/50 mt-0.5">{weather.current.condition}</div>
          </div>
        </div>
        <div className="text-right">
          <div className="font-mono text-[11px] uppercase tracking-wider text-white/40">
            {weather.city}
          </div>
          {weather.daily[0] && (
            <div className="text-[11px] text-white/30 mt-0.5">
              H: {weather.daily[0].high}° &nbsp; L: {weather.daily[0].low}°
            </div>
          )}
        </div>
      </div>

      {/* Hourly strip */}
      <div className="mb-4">
        <div className="font-mono text-[10px] uppercase tracking-wider text-white/40 mb-2">
          Today
        </div>
        <div ref={hourlyRef} className="flex gap-0.5 overflow-x-auto pb-1 scrollbar-hide">
          {visibleHours.map((h, i) => {
            const isNow = i === 0 && nowHourIdx >= 0;
            return (
              <div
                key={h.hour}
                className={`flex flex-col items-center gap-1 px-2.5 py-2 rounded-lg min-w-[48px] ${
                  isNow
                    ? "bg-blue-500/10 border border-blue-500/20"
                    : ""
                }`}
              >
                <span className={`text-[10px] ${isNow ? "text-blue-400 font-semibold" : "text-white/40"}`}>
                  {isNow ? "Now" : formatHour(h.hour)}
                </span>
                <span className="text-[13px] leading-none">{h.icon}</span>
                <span className="text-xs text-white/80">{h.temp}°</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* 7-day forecast */}
      <div>
        <div className="font-mono text-[10px] uppercase tracking-wider text-white/40 mb-2">
          This Week
        </div>
        <div className="flex flex-col gap-px">
          {weather.daily.map((d, i) => {
            const isToday = d.date === today;
            const leftPct = ((d.low - weekMin) / weekRange) * 100;
            const rightPct = 100 - ((d.high - weekMin) / weekRange) * 100;
            return (
              <div
                key={d.date}
                className={`flex items-center py-1.5 px-2 rounded-md ${
                  isToday ? "bg-blue-500/5" : ""
                }`}
              >
                <span className={`text-xs w-12 ${isToday ? "text-blue-400 font-medium" : "text-white/50"}`}>
                  {getDayLabel(d.date)}
                </span>
                <span className="text-sm w-7 text-center">{d.icon}</span>
                <span className="text-[11px] text-white/35 w-8 text-right">{d.low}°</span>
                <div className="flex-1 h-1 rounded-full bg-white/5 mx-2.5 relative overflow-hidden">
                  <div
                    className="absolute h-full rounded-full"
                    style={{
                      left: `${leftPct}%`,
                      right: `${rightPct}%`,
                      background: "linear-gradient(90deg, rgba(59,130,246,0.5), rgba(251,191,36,0.5))",
                    }}
                  />
                </div>
                <span className="text-[11px] text-white/80 w-8">{d.high}°</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Typecheck**

```bash
pnpm typecheck
```

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/WeatherPill.tsx packages/ui/src/WeatherExpanded.tsx
git commit -m "feat(weather): add WeatherPill and WeatherExpanded UI components"
```

---

## Task 9: Omnibar Integration

**Files:**
- Modify: `packages/ui/src/Omnibar.tsx`

- [ ] **Step 1: Add weather props to Omnibar**

Add to `OmnibarProps`:

```typescript
  weather?: WeatherData | null;
  weatherLoading?: boolean;
  onWeatherClick?: () => void;
  showWeatherExpanded?: boolean;
```

Import the types and components:

```typescript
import type { WeatherData } from "@brett/types";
import { WeatherPill, WeatherPillSkeleton } from "./WeatherPill";
import { WeatherExpanded } from "./WeatherExpanded";
```

- [ ] **Step 2: Add weather pill to collapsed input bar**

In the `{/* Top Bar */}` section (the `!hasConversation` block), insert the weather pill between the input and the `⌘K` kbd. Find the closing `/>` of the `<input>` element and after it add:

```tsx
{/* Weather pill */}
{weatherLoading && <WeatherPillSkeleton />}
{!weatherLoading && weather && onWeatherClick && (
  <WeatherPill
    current={weather.current}
    isActive={showWeatherExpanded ?? false}
    onClick={onWeatherClick}
  />
)}
```

- [ ] **Step 3: Add weather expanded view**

After the `{/* Top Bar */}` block and before the `{/* AI Upsell */}` block, add:

```tsx
{/* Weather Expanded View */}
{showWeatherExpanded && weather && !hasConversation && (
  <div className="border-t border-white/10 max-h-[400px] overflow-y-auto scrollbar-hide">
    <WeatherExpanded weather={weather} />
  </div>
)}
```

- [ ] **Step 4: Typecheck**

```bash
pnpm typecheck
```

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/Omnibar.tsx
git commit -m "feat(weather): integrate weather pill and expanded view into Omnibar"
```

---

## Task 10: Wire Up Weather in Desktop App

**Files:**
- Modify: the file that renders the Omnibar (likely `apps/desktop/src/App.tsx` or wherever Omnibar is instantiated)

- [ ] **Step 1: Find and read the Omnibar integration point**

Search for where `<Omnibar` is rendered in the desktop app — likely in the main layout or App component. Read that file.

- [ ] **Step 2: Add weather state and hooks**

In the component that renders Omnibar, add:

```typescript
import { useWeather } from "./api/weather";

// Inside the component:
const { weather, isLoading: weatherLoading } = useWeather();
const [showWeatherExpanded, setShowWeatherExpanded] = useState(false);
```

- [ ] **Step 3: Pass weather props to Omnibar**

Add to the `<Omnibar>` JSX:

```tsx
weather={weather}
weatherLoading={weatherLoading}
showWeatherExpanded={showWeatherExpanded}
onWeatherClick={() => setShowWeatherExpanded((prev) => !prev)}
```

Also close weather expanded when the Omnibar closes — in the existing `onClose` handler, add `setShowWeatherExpanded(false)`.

- [ ] **Step 4: Typecheck and verify**

```bash
pnpm typecheck
```

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/
git commit -m "feat(weather): wire up weather hooks and state in desktop app"
```

---

## Task 11: Briefing Integration

**Files:**
- Modify: `packages/ai/src/context/system-prompts.ts`
- Modify: `packages/ai/src/context/assembler.ts`

- [ ] **Step 1: Update briefing system prompt**

In `packages/ai/src/context/system-prompts.ts`, append to the `BRIEFING_SYSTEM_PROMPT` string, before the closing backtick/security block:

```typescript
// Add to the rules section of BRIEFING_SYSTEM_PROMPT:
`- If weather data is provided, only mention it when actionable or notable — rain/snow affecting commutes to calendar event locations, extreme temperatures, or severe weather alerts. Do not comment on fair or unremarkable weather.`
```

- [ ] **Step 2: Inject weather context into briefing assembly**

In `packages/ai/src/context/assembler.ts`, within the briefing assembly function (around line 293-415):

Add a weather cache query to the existing `Promise.all` (the one that fetches overdue tasks, today tasks, calendar events). Add it as an additional element in the destructured array. Use `input.userId` (not bare `userId`) to match the existing code pattern.

Also add to the same `Promise.all`: a user query for `weatherEnabled`, `tempUnit`, and `countryCode`.

```typescript
import { resolveTempUnit, convertTemp } from "@brett/utils";

// Inside the existing Promise.all destructuring, add:
const [overdueTasks, overdueCount, todayTasks, todayEvents, weatherData] = await Promise.all([
  // ... existing queries ...
  // Add this as the 5th element:
  prisma.weatherCache.findUnique({
    where: { userId: input.userId },
    select: { current: true, daily: true },
  }).then(async (cache) => {
    if (!cache) return null;
    const user = await prisma.user.findUnique({
      where: { id: input.userId },
      select: { weatherEnabled: true, tempUnit: true, countryCode: true },
    });
    if (!user?.weatherEnabled) return null;
    return { cache, tempUnit: user.tempUnit, countryCode: user.countryCode };
  }),
]);
```

Then in the data formatting section (where `dataParts` is assembled), add weather context:

```typescript
// After formatting tasks and events, before closing the dataParts assembly:
if (weatherData) {
  const unit = resolveTempUnit(weatherData.tempUnit, weatherData.countryCode ?? undefined);
  const current = weatherData.cache.current as any;
  const daily = (weatherData.cache.daily as any[])?.[0];
  const unitLabel = unit === "fahrenheit" ? "F" : "C";
  const convert = (t: number) => convertTemp(t, unit);

  let weatherBlock = `Current weather: ${convert(current.temp)}°${unitLabel}, ${current.condition}`;
  if (daily) {
    weatherBlock += `\nToday: High ${convert(daily.high)}°${unitLabel}, Low ${convert(daily.low)}°${unitLabel}, ${daily.precipProb}% chance of rain`;
  }
  dataParts.push(weatherBlock);
}
```

- [ ] **Step 3: Typecheck**

```bash
pnpm typecheck
```

- [ ] **Step 4: Commit**

```bash
git add packages/ai/src/context/ packages/utils/
git commit -m "feat(weather): integrate weather into daily briefing prompt"
```

---

## Task 12: Final Integration Test & Cleanup

- [ ] **Step 1: Run all tests**

```bash
pnpm test
```

- [ ] **Step 2: Typecheck everything**

```bash
pnpm typecheck
```

- [ ] **Step 3: Run dev and verify end-to-end**

```bash
pnpm dev
```

Manually verify:
- Weather pill appears in omnibar (after location auto-detected or set)
- Clicking pill shows expanded forecast
- Hourly strip scrolls, "Now" is highlighted
- 7-day forecast shows with temp bars
- Settings: weather toggle, city search, temp unit picker all work
- Changing city in settings → timezone updates (when auto-detect is off)
- Disabling weather → pill disappears
- Generate a briefing → weather mentioned only when notable

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat(weather): complete weather feature integration"
```
