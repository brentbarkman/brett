/**
 * Weather API integration tests.
 *
 * External HTTP calls are mocked at the fetch layer:
 *   - Open-Meteo geocoding (https://geocoding-api.open-meteo.com) → fixture
 *   - Google Weather / AQI (*.googleapis.com) → fixture (used when
 *     GOOGLE_WEATHER_API_KEY is set; otherwise those tests skip)
 * All other fetches pass through to the real implementation so unrelated
 * services (if any) still work. This keeps the suite deterministic in CI.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { app } from "../app.js";
import { createTestUser, authRequest } from "./helpers.js";
import { prisma } from "../lib/prisma.js";

const hasWeatherKey = !!process.env.GOOGLE_WEATHER_API_KEY;
const itWithWeather = hasWeatherKey ? it : it.skip;

// ── fetch mock ────────────────────────────────────────────────────────────────

const originalFetch = globalThis.fetch;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const geocodeFixture = {
  results: [
    {
      name: "San Francisco",
      admin1: "California",
      country: "United States",
      country_code: "US",
      latitude: 37.7749,
      longitude: -122.4194,
      timezone: "America/Los_Angeles",
    },
  ],
};

// Minimal Google Weather fixtures — only shapes the service reads.
const googleCurrentFixture = {
  temperature: { degrees: 18, unit: "CELSIUS" },
  feelsLikeTemperature: { degrees: 17, unit: "CELSIUS" },
  weatherCondition: { type: "PARTLY_CLOUDY", description: { text: "Partly cloudy" } },
  wind: { speed: { value: 10, unit: "KILOMETERS_PER_HOUR" }, direction: { degrees: 270 } },
};

const googleHourlyFixture = {
  forecastHours: [
    {
      interval: { startTime: new Date().toISOString() },
      temperature: { degrees: 18, unit: "CELSIUS" },
      weatherCondition: { type: "PARTLY_CLOUDY" },
      precipitation: { probability: { percent: 10 } },
    },
  ],
};

const googleDailyFixture = {
  forecastDays: [
    {
      displayDate: { year: 2026, month: 4, day: 14 },
      maxTemperature: { degrees: 20, unit: "CELSIUS" },
      minTemperature: { degrees: 12, unit: "CELSIUS" },
      daytimeForecast: {
        weatherCondition: { type: "PARTLY_CLOUDY" },
        precipitation: { probability: { percent: 10 } },
      },
    },
  ],
};

const googleAqiFixture = { indexes: [{ code: "uaqi", aqi: 42, category: "Good" }] };

beforeAll(() => {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

    if (url.startsWith("https://geocoding-api.open-meteo.com")) {
      return jsonResponse(geocodeFixture);
    }
    if (url.startsWith("https://weather.googleapis.com/v1/currentConditions")) {
      return jsonResponse(googleCurrentFixture);
    }
    if (url.startsWith("https://weather.googleapis.com/v1/forecast/hours")) {
      return jsonResponse(googleHourlyFixture);
    }
    if (url.startsWith("https://weather.googleapis.com/v1/forecast/days")) {
      return jsonResponse(googleDailyFixture);
    }
    if (url.startsWith("https://airquality.googleapis.com")) {
      return jsonResponse(googleAqiFixture);
    }
    if (url.startsWith("https://ipapi.co/")) {
      // Tests in this file never trigger IP geolocation, but fail fast if they do.
      return jsonResponse({ error: true, reason: "mocked" }, 404);
    }

    return originalFetch(input as any, init);
  }) as typeof fetch;
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

// ── GET /weather ──

describe("GET /weather", () => {
  let token: string;
  let userId: string;

  beforeAll(async () => {
    ({ token, userId } = await createTestUser("Weather User"));
  });

  it("returns { weather: null, reason: 'no_location' } when no location set and no IP header", async () => {
    const res = await authRequest("/weather", token);
    expect(res.status).toBe(200);

    const body = (await res.json()) as any;
    expect(body.weather).toBeNull();
    expect(body.reason).toBe("no_location");
  });

  it("returns { weather: null, reason: 'disabled' } when weatherEnabled is false", async () => {
    await prisma.user.update({
      where: { id: userId },
      data: { weatherEnabled: false },
    });

    const res = await authRequest("/weather", token);
    expect(res.status).toBe(200);

    const body = (await res.json()) as any;
    expect(body.weather).toBeNull();
    expect(body.reason).toBe("disabled");

    // Reset for subsequent tests
    await prisma.user.update({
      where: { id: userId },
      data: { weatherEnabled: true },
    });
  });

  itWithWeather("returns weather data when location is set", async () => {
    // Set location directly via prisma (San Francisco)
    await prisma.user.update({
      where: { id: userId },
      data: {
        latitude: 37.7749,
        longitude: -122.4194,
        city: "San Francisco",
        countryCode: "US",
      },
    });

    const res = await authRequest("/weather", token);
    expect(res.status).toBe(200);

    const body = (await res.json()) as any;
    expect(body.weather).toBeDefined();
    expect(body.weather).not.toBeNull();
    expect(body.weather.city).toBe("San Francisco");
    expect(typeof body.weather.current.temp).toBe("number");
    expect(typeof body.weather.current.condition).toBe("string");
    expect(typeof body.weather.current.icon).toBe("string");
    expect(body.weather.fetchedAt).toBeDefined();
    expect(Array.isArray(body.weather.hourly)).toBe(true);
    expect(Array.isArray(body.weather.daily)).toBe(true);
    expect(body.weather.isStale).toBe(false);
  });

  itWithWeather("returns cached data on subsequent requests (fetchedAt should match)", async () => {
    // First request (cache should already be populated from previous test)
    const res1 = await authRequest("/weather", token);
    const body1 = (await res1.json()) as any;
    expect(body1.weather).not.toBeNull();
    const fetchedAt1 = body1.weather.fetchedAt;

    // Second request — should return cached data
    const res2 = await authRequest("/weather", token);
    const body2 = (await res2.json()) as any;
    expect(body2.weather).not.toBeNull();
    const fetchedAt2 = body2.weather.fetchedAt;

    expect(fetchedAt1).toBe(fetchedAt2);
  });
});

// ── GET /weather/geocode ──

describe("GET /weather/geocode", () => {
  let token: string;

  beforeAll(async () => {
    ({ token } = await createTestUser("Geocode User"));
  });

  it("returns 400 for queries shorter than 2 chars", async () => {
    const res = await authRequest("/weather/geocode?q=a", token);
    expect(res.status).toBe(400);

    const body = (await res.json()) as any;
    expect(body.error).toBeDefined();
  });

  it("returns results with correct shape for valid query", async () => {
    const res = await authRequest("/weather/geocode?q=San%20Francisco", token);
    expect(res.status).toBe(200);

    const body = (await res.json()) as any;
    expect(Array.isArray(body.results)).toBe(true);
    expect(body.results.length).toBeGreaterThan(0);

    const first = body.results[0];
    expect(typeof first.name).toBe("string");
    expect(typeof first.country).toBe("string");
    expect(typeof first.countryCode).toBe("string");
    expect(typeof first.latitude).toBe("number");
    expect(typeof first.longitude).toBe("number");
    expect(typeof first.timezone).toBe("string");
    expect(typeof first.displayName).toBe("string");
  });
});

// ── PATCH /users/location ──

describe("PATCH /users/location", () => {
  let token: string;
  let userId: string;

  beforeAll(async () => {
    ({ token, userId } = await createTestUser("Location User"));
  });

  it("updates location fields successfully", async () => {
    const res = await authRequest("/users/location", token, {
      method: "PATCH",
      body: JSON.stringify({
        city: "Los Angeles",
        countryCode: "US",
        latitude: 34.0522,
        longitude: -118.2437,
        tempUnit: "fahrenheit",
      }),
    });

    expect(res.status).toBe(200);

    const body = (await res.json()) as any;
    expect(body.city).toBe("Los Angeles");
    expect(body.countryCode).toBe("US");
    expect(body.latitude).toBe(34.0522);
    expect(body.longitude).toBe(-118.2437);
    expect(body.tempUnit).toBe("fahrenheit");
  });

  itWithWeather("invalidates weather cache on location change", async () => {
    // Set location and fetch weather to populate cache
    await prisma.user.update({
      where: { id: userId },
      data: {
        latitude: 40.7128,
        longitude: -74.006,
        city: "New York",
        countryCode: "US",
        weatherEnabled: true,
      },
    });

    const weatherRes = await authRequest("/weather", token);
    const weatherBody = (await weatherRes.json()) as any;
    expect(weatherBody.weather).not.toBeNull();

    // Verify cache exists
    const cacheBeforeChange = await prisma.weatherCache.findUnique({
      where: { userId },
    });
    expect(cacheBeforeChange).not.toBeNull();

    // Change location — should invalidate cache
    await authRequest("/users/location", token, {
      method: "PATCH",
      body: JSON.stringify({
        city: "Chicago",
        latitude: 41.8781,
        longitude: -87.6298,
      }),
    });

    // Verify cache is gone
    const cacheAfterChange = await prisma.weatherCache.findUnique({
      where: { userId },
    });
    expect(cacheAfterChange).toBeNull();
  });

  it("rejects invalid tempUnit with 400", async () => {
    const res = await authRequest("/users/location", token, {
      method: "PATCH",
      body: JSON.stringify({ tempUnit: "kelvin" }),
    });

    expect(res.status).toBe(400);

    const body = (await res.json()) as any;
    expect(body.error).toBeDefined();
  });

  it("allows updating weatherEnabled independently (no lat/lon required)", async () => {
    const res = await authRequest("/users/location", token, {
      method: "PATCH",
      body: JSON.stringify({ weatherEnabled: false }),
    });

    expect(res.status).toBe(200);

    const body = (await res.json()) as any;
    expect(body.weatherEnabled).toBe(false);

    // Verify in DB
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { weatherEnabled: true },
    });
    expect(user?.weatherEnabled).toBe(false);
  });
});
