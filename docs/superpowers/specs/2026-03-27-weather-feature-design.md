# Weather Feature Design

**Date:** 2026-03-27
**Status:** Approved

## Overview

Add current weather display to the Omnibar with an expandable hourly + weekly forecast view. Weather data is fetched server-side from Open-Meteo (free, no API key), cached per-user, and surfaced in the daily briefing when notable.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Weather provider | Open-Meteo | Free, no API key, uses ECMWF + national weather service models, zero setup friction |
| Architecture | Server-side fetch + cache | Briefing needs weather data server-side; single cache, one fetch path |
| Location detection | IP-based geolocation | Electron's Geolocation API requires a Google API key and has macOS bugs; IP is silent and city-level accurate |
| Location override | City search via Open-Meteo Geocoding API | Validates city + returns lat/lon + timezone; no freeform text |
| Temp units | Auto-detect from locale, user override | US/Liberia/Myanmar → F, everywhere else → C |
| UI surface | Omnibar only (not Spotlight) | Omnibar is persistent; Spotlight is transient search |
| Expand mechanism | Weather content panel within Omnibar (like conversations) | Clicking pill opens content area below input bar |
| Briefing integration | Prompt instruction, today only | AI decides what's notable; only current conditions + today's forecast passed (save tokens) |
| City → timezone sync | Silent update when timezoneAuto is OFF | If manually managing location, timezone should follow city |

## Data Model

### User table additions (Prisma)

```prisma
city            String?   // Display name, e.g. "San Francisco, California, US"
latitude        Float?    // For Open-Meteo queries
longitude       Float?    // For Open-Meteo queries
tempUnit        String    @default("auto")  // "auto" | "fahrenheit" | "celsius"
weatherEnabled  Boolean   @default(true)
```

`tempUnit: "auto"` derives from locale: US/Liberia/Myanmar → fahrenheit, everywhere else → celsius.

The existing `GET /users/me` endpoint must be updated to return the new weather fields (`city`, `latitude`, `longitude`, `tempUnit`, `weatherEnabled`).

### New table: WeatherCache

```prisma
model WeatherCache {
  id        String   @id @default(cuid())
  userId    String   @unique
  fetchedAt DateTime
  expiresAt DateTime
  current   Json     // { temp, feelsLike, conditionCode, humidity, windSpeed, icon }
  hourly    Json     // [{ hour, temp, conditionCode, icon, precipProb }] — 24 entries
  daily     Json     // [{ date, high, low, conditionCode, icon, precipProb }] — 7 entries

  user      User     @relation(fields: [userId], references: [id])
}
```

One cache row per user (enforced by `@unique` on `userId`). Use Prisma `upsert` on refresh. Expires after 1 hour.

## API

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/weather` | Returns current + hourly + daily from cache; fetches from Open-Meteo if stale/missing |
| `PATCH` | `/users/location` | Save any combination of: city, lat, lon, tempUnit, weatherEnabled (all fields optional) |

All fields in `PATCH /users/location` are optional — toggling `weatherEnabled` off doesn't require sending lat/lon. This matches the pattern of the existing `PATCH /users/timezone` endpoint.

When `city`/`latitude`/`longitude` change via this endpoint, delete the existing WeatherCache row for that user so stale location data isn't served.

### IP Geolocation

On first `GET /weather` request, if user has no location set:
1. Resolve client IP to city/coords using ip-api.com server-side (free tier, HTTP, 45 req/min — sufficient for per-user first-visit). Alternative: ipapi.co for HTTPS if needed.
2. Read IP from `X-Forwarded-For` header (Railway sets this) — do NOT use the raw peer address, which resolves to Railway's internal network.
3. Save city, latitude, longitude to user record
4. Fetch weather and return

### Open-Meteo Integration

**Forecast API:** `https://api.open-meteo.com/v1/forecast`
- Parameters: `latitude`, `longitude`, `hourly` (temperature_2m, weather_code, precipitation_probability), `daily` (temperature_2m_max, temperature_2m_min, weather_code, precipitation_probability_max), `timezone` (user's timezone)
- Note: use `weather_code` (with underscore), not the deprecated `weathercode`
- Returns 7-day forecast with hourly breakdown

**Geocoding API:** `https://geocoding-api.open-meteo.com/v1/search`
- Parameters: `name` (search query), `count` (max results)
- Returns: city name, state/country, latitude, longitude, timezone
- Used by the settings city search dropdown

## UI

### Omnibar Weather Pill (Collapsed)

A small glass pill on the right side of the Omnibar input bar, between the text input and the ⌘K badge:

- Shows: condition emoji/icon + current temperature (e.g. "⛅ 64°")
- Styling: `bg-white/5 border border-white/[0.08] rounded-full px-2.5 py-1`
- Clickable — expands the Omnibar to show weather detail
- Hidden when `weatherEnabled` is false or location is not set
- **Loading state:** When location is set but no cache exists yet (first fetch in flight), show a skeleton pill (shimmer animation, same dimensions) consistent with the app's existing skeleton loading pattern
- **During conversations:** The weather pill is hidden when a conversation is active (the input bar is replaced by the conversation UI). The pill reappears when the conversation is closed. This is acceptable — weather is ambient info, not needed during active chat.

### Expanded Weather View

When the weather pill is clicked, the Omnibar opens a content panel below the input bar (same container expansion pattern as conversations — the input bar stays at the top with a `border-bottom`, and weather content renders below it in a scrollable area). Clicking the pill again or clicking outside closes it.

**Current conditions header:**
- Large temp (28px), condition icon (32px emoji), condition label
- City name (mono uppercase, right-aligned), today's high/low

**Hourly strip:**
- Horizontal scrollable row of hour cells
- Each cell: time label, condition icon, temperature
- "Now" cell highlighted with blue accent (`bg-blue-500/10 border border-blue-500/20`)
- Shows remaining hours in the day

**7-day forecast:**
- Vertical list, one row per day
- Each row: day name, condition icon, low temp, temperature range bar, high temp
- Temperature bars: gradient from blue (cool) to amber (warm), positioned relative to the week's min/max range
- "Today" row highlighted with blue accent text

**Design system compliance:**
- Glass morphism surfaces (`bg-black/30 backdrop-blur-xl border border-white/10`)
- Section headers: `font-mono text-xs uppercase tracking-wider text-white/40`
- Text hierarchy follows opacity scale (headings white/95, body white/80, metadata white/40)
- Blue accent for active/current states, matching existing color system

### Spotlight Modal

No weather in the Spotlight (⌘K) modal. Weather is an Omnibar-only feature.

## Settings

New **Location** section in the settings page (`LocationSection.tsx`):

1. **Weather enabled** — toggle (default on)
2. **City** — search-as-you-type dropdown backed by Open-Meteo Geocoding API
   - Shows "city, state/region, country" format
   - Auto-populated from IP on first use, shows "(detected from IP)" label
   - Selecting a result saves city name + lat/lon to user record
   - When `timezoneAuto` is OFF, selecting a city silently updates the timezone to match the city's timezone (returned by Open-Meteo Geocoding API)
   - When `timezoneAuto` is ON, selecting a city does NOT change the timezone (browser still owns timezone detection)
3. **Temperature unit** — dropdown: Auto (from locale) / Fahrenheit / Celsius

## Briefing Integration

### Context injection

When generating a daily briefing, if weather is enabled and cached data exists, append to the briefing context. Temperatures use the user's resolved `tempUnit` preference (resolve "auto" to F or C based on locale before injecting):

```
Current weather: 64°F, Partly Cloudy
Today: High 68°F, Low 54°F, 20% chance of rain
```

Only current conditions and today's forecast — no multi-day data (save tokens).

### Prompt instruction

Appended to the existing briefing system prompt:

> "Weather forecast is provided below. Only mention weather when it's actionable or notable — rain/snow affecting commutes to calendar event locations, extreme temperatures, or severe weather alerts. Do not comment on fair or unremarkable weather."

### No weather = no mention

If weather is disabled or location isn't set, the weather context block is omitted entirely. The AI won't mention weather because it has no data.

## Edge Cases

- **No location:** Weather pill is hidden. No weather in briefing. Settings shows empty city with prompt to search.
- **IP geolocation fails:** Fail silently. Weather pill stays hidden until user manually sets a city.
- **Open-Meteo down:** Serve stale cache if available (even if expired). If no cache, hide weather pill gracefully. No error UI — weather is supplementary.
- **Cache expiry:** 1 hour TTL. On `GET /weather`, if cache is stale, fetch fresh data from Open-Meteo. If fetch fails, return stale data with a flag indicating staleness.
- **Location change:** When city/lat/lon changes via `PATCH /users/location`, delete existing WeatherCache row so stale data isn't served.
- **Timezone change:** Hourly forecast uses user's timezone (passed to Open-Meteo). If user changes timezone, weather cache is invalidated.
- **First fetch (no cache):** Weather pill shows skeleton/shimmer state while initial fetch completes.
- **Weather pill during conversation:** Hidden — reappears when conversation is closed.
