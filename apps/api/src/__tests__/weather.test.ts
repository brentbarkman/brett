/**
 * Weather API integration tests.
 *
 * NETWORK DEPENDENCY: The geocoding tests hit the real Open-Meteo geocoding
 * API (free, no key required). The weather fetch tests hit OpenWeatherMap's
 * One Call 3.0 API (requires OPENWEATHERMAP_API_KEY env var).
 * Tests may fail if the external service is down.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { app } from "../app.js";
import { createTestUser, authRequest } from "./helpers.js";
import { prisma } from "../lib/prisma.js";

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

  it("returns weather data when location is set", async () => {
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

  it("returns cached data on subsequent requests (fetchedAt should match)", async () => {
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

  it("invalidates weather cache on location change", async () => {
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
