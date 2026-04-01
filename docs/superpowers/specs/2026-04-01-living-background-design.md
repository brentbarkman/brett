# Living Background System

**Date:** 2026-04-01
**Status:** Design approved

## Overview

A dynamic background system that makes Brett feel alive and responsive to context. Backgrounds shift based on time of day and workload intensity, creating an ambient environmental layer inspired by Apple Weather's "data as art" philosophy.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Image sourcing | Curated set on Railway Object Storage | Total control over quality and mood. No external API dependency. |
| Visual style (default) | Real landscape photography, no color overlay | Each photo carries its own mood natively. Overlay unnecessary with intentional curation. |
| Alternative style | Abstract gradients/shapes/colors | User preference for people who don't want photographs. Same time/busyness mapping. |
| Time segments | 6 (Dawn, Morning, Afternoon, Golden Hour, Evening, Night) | Dawn and Golden Hour are visually distinct moments that deserve their own treatment. |
| Busyness tiers | 3 (Light, Moderate, Packed) | Expressive enough to communicate workload without over-segmenting. |
| Busyness expression | Image selection (different photos per tier) | More visceral than overlay-only. Each tier has a distinct visual character. |
| Architecture | Client-side selection | Client already has time + task/meeting data. No new API surface needed. |
| Transition behavior | Instant on launch, crossfade rotation during use | Correct image immediately on open. Slow rotation (~10min) within a segment keeps it alive. |

## Image Categories

6 time segments × 3 busyness tiers = **18 categories** per set.
3 images minimum per category = **54+ images per set**.
2 sets (Photography + Abstract) = **108+ images total**, ~20-30MB storage.

### Photography Mood Mapping

| Segment | Light Day | Moderate Day | Packed Day |
|---------|-----------|-------------|------------|
| **Dawn** (5–7am) | Misty lake, soft pastels | Rolling hills, gentle fog | Mountain ridge, pre-storm dawn |
| **Morning** (7am–12pm) | Open beach, clear sky | Alpine meadow, bright sun | Dense forest canopy, dappled light |
| **Afternoon** (12–5pm) | Desert expanse, wide horizon | Vineyard rows, structured warmth | Canyon walls, dramatic shadows |
| **Golden Hour** (5–7pm) | Calm shoreline, amber light | Wheat field, rich golds | Volcanic landscape, intense orange |
| **Evening** (7–9pm) | Still water, cool blues | City from a distance, twilight | Moody coastline, dark clouds |
| **Night** (9pm–5am) | Starfield, open sky | Moon over mountains | Northern lights, electric |

**Principle:** Light = open, expansive, breathing room. Packed = dramatic, intense, tighter compositions. Not menacing — focused. "Let's fucking go" energy.

### Abstract Set

Same emotional mapping with mesh gradients, soft blurs, organic shapes:
- Dawn = cool lavenders/pinks → Night = deep indigos/navy
- Light = diffuse, more negative space → Packed = more saturated, denser gradients
- Reference: macOS Sonoma/Sequoia wallpapers

## Busyness Formula

```
score = (meetingCount × 2) + taskCount

Light:    score ≤ 4
Moderate: score 5–10
Packed:   score > 10
```

**Inputs:**
- `taskCount`: Today's incomplete tasks — new query filtering by `dueDate` within today's bounds (using `getUserDayBounds(userTimezone)`). Not the existing "this week" query, which would inflate the score.
- `meetingCount`: Today's non-all-day calendar events (reuse existing `todayCalendarEvents` from App.tsx, which already filters all-day events). All-day events (e.g., "OOO", holidays) don't count — they don't create the "time is claimed" pressure that meetings do.

Thresholds tunable. Recalculates when task/meeting data changes via React Query cache invalidation — no dedicated polling.

## Time Segments

| Segment | Hours | Character |
|---------|-------|-----------|
| Dawn | 5am–7am | Crisp, quiet, anticipatory |
| Morning | 7am–12pm | Energetic, bright, forward-looking |
| Afternoon | 12pm–5pm | Warm, steady, productive |
| Golden Hour | 5pm–7pm | Rich, winding down, reflective |
| Evening | 7pm–9pm | Cool, calm, unwinding |
| Night | 9pm–5am | Deep, minimal, restful |

Segment detection uses a 60-second `setInterval` plus a `document.visibilitychange` listener. The interval handles normal operation; the visibility listener catches wake-from-sleep (where `setInterval` doesn't fire during sleep). On visibility change to `visible`, immediately re-evaluate the segment and crossfade if it changed.

## Architecture

### Image Manifest

Static JSON bundled in the desktop app at `apps/desktop/src/data/background-manifest.json`:

```json
{
  "version": 1,
  "sets": {
    "photography": {
      "dawn": {
        "light": ["dawn/light-1.webp", "dawn/light-2.webp", "dawn/light-3.webp"],
        "moderate": ["dawn/moderate-1.webp", "dawn/moderate-2.webp", "dawn/moderate-3.webp"],
        "packed": ["dawn/packed-1.webp", "dawn/packed-2.webp", "dawn/packed-3.webp"]
      }
    },
    "abstract": {
      "dawn": {
        "light": ["abstract/dawn/light-1.webp", ...],
      }
    }
  }
}
```

### Storage

Railway Object Storage, same bucket as login videos. URL resolution: `${storageBaseUrl}/backgrounds/${relativePath}`.

**Base URL availability:** The existing `/config` endpoint returns `videoBaseUrl`, but this is only consumed in `LoginPage.tsx`. Add a shared `useAppConfig` hook (or extend an existing app-level config fetch) that calls `/config` on app mount and makes `storageBaseUrl` (renamed from `videoBaseUrl` for generality) available app-wide via React context or a cached React Query call. The login page's `useLoginVideos` can then consume the same source. Alternatively, keep `videoBaseUrl` naming and just consume it from a shared hook — naming is a minor detail.

Image specs:
- Resolution: 1920×1080
- Format: WebP
- Target file size: 150–300KB
- `Cache-Control` headers for long-term browser caching (images are immutable, versioned via manifest)

### Hook: `useBackground`

Location: `apps/desktop/src/hooks/useBackground.ts`

**Inputs:** current time, task count, meeting count, user background preference (photography/abstract)

**Outputs:** `{ imageUrl, nextImageUrl, isTransitioning, segment, busynessTier }`

Exposing `segment` and `busynessTier` allows other components (greetings, briefing, personality copy) to consume the same signals without re-deriving them.

**Behavior:**
1. On mount: resolve segment + busyness → pick random image from category → display immediately
2. Every ~10 minutes: crossfade to a different image from the same category
3. On segment boundary: crossfade to new segment's category
4. On busyness tier change: next rotation pick uses new tier (no abrupt swap — drifts naturally)

### Component: `LivingBackground`

Location: `packages/ui/src/LivingBackground.tsx`

```tsx
interface LivingBackgroundProps {
  imageUrl: string
  nextImageUrl: string | null
  isTransitioning: boolean
}
```

**Replaces** the three existing hardcoded divs in App.tsx (lines 811-825): the Unsplash background image, the vignette overlay, and the left scrim. All three are absorbed into this single component.

Renders:
1. **Image layer A** — crossfade layer (absolute, z-0, bg-cover bg-center, full opacity — no base opacity reduction)
2. **Image layer B** — crossfade layer (absolute, z-0, bg-cover bg-center, full opacity)
3. **Vignette** — `bg-gradient-to-b from-black/40 via-transparent to-black/60` (readability)
4. **Left scrim** — `bg-gradient-to-r from-black/60 to-transparent w-[312px]` (readability)

Images render at full opacity (not the current `opacity-80`). The vignette and scrim provide sufficient readability isolation — the extra 20% dimming was a crutch for a single static image. Curated images tested against glass surfaces won't need it.

**Use `<img>` elements, not CSS `background-image`.** The crossfade requires `onload` detection, which CSS background-image doesn't support. Each layer is an `<img>` with `object-fit: cover` + `w-full h-full absolute inset-0` — same visual result as `bg-cover bg-center`, but with `onload` hooks.

Crossfade mechanism: two `<img>` layers, one `opacity-100`, one `opacity-0`. On rotation, set new `src` on the hidden layer, wait for `onload`, then flip opacities. CSS `transition-opacity duration-[3000ms]` handles the dissolve. If the image hasn't loaded when the rotation timer fires, wait for load — never crossfade to a blank/broken layer.

**Rotation within a category:** Shuffle without replacement. Track shown images and cycle through all images in a category before repeating. With 3 images and 10-minute rotation, the full set plays over 30 minutes before cycling. **Shuffle state resets when the category changes** (segment or busyness tier shift) — start fresh in the new category.

### Settings

New "Background Style" option in Settings page:
- Photography (default)
- Abstract

**Storage:** New `backgroundStyle` column on the `User` model (`String`, default `"photography"`), consistent with how `tempUnit` and `weatherEnabled` are stored. Requires a Prisma migration. Read/write via the existing user update endpoint (`PATCH /user` or equivalent). Desktop consumes via the existing user query.

**Input validation:** The API must enforce `backgroundStyle` as an enum — only `"photography"` or `"abstract"` accepted. Reject any other value. Use Prisma enum or validate in the PATCH handler before writing. Do not store arbitrary user strings.

## Performance

- **DOM:** Only 2 image elements at any time (crossfade layers)
- **Preloading:** Next rotation image preloaded via `new Image().src`. 5 minutes before a segment boundary, preload one random image from the next segment's current busyness tier.
- **Memory:** Preloaded images are browser-cached, not held in JS memory
- **Caching:** Long-term `Cache-Control` on Railway storage. Images are immutable.
- **Timer:** 60-second interval check (lightweight)

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| First launch (empty cache) | Show bundled fallback immediately, fetch correct image in background, crossfade when loaded. The fallback should be a good-looking dark landscape — it's the first impression for new users. |
| App launched offline | Show last cached image. Try to fetch in background. |
| No cache, no network | Bundled fallback image at `apps/desktop/src/assets/fallback-bg.webp` (dark neutral landscape, imported via Vite asset handling) |
| Image fails to load | Silently stay on current image, retry on next rotation |
| App wakes from sleep in new segment | Crossfade immediately to correct segment |
| Busyness changes mid-session | Next rotation pick uses new tier — no abrupt swap |
| User switches preference (photo ↔ abstract) | Crossfade to new set immediately |

## Known Characteristics

- **No-calendar users:** Without Google Calendar connected, `meetingCount` is always 0. The formula becomes just `taskCount`, so users skew light/moderate. This is correct — their day *is* lighter from the app's perspective if we can't see meetings. Not a bug.
- **Manifest is bundled, images are remote:** Image files can be swapped/added on Railway storage anytime without an app update. But adding new categories or changing the manifest schema requires a desktop release. Acceptable for v1.
- **Public bucket exposure:** Background images share the Railway Object Storage bucket with login videos, which is already public. Verify no sensitive files share the same bucket/prefix.

## Future: Personality Evolution

This system is designed to support personality evolution later:
- Brett's voice/copy can key off the same segment + busyness signals
- The `useBackground` hook's segment/busyness state can be shared with greeting/briefing components
- No architectural changes needed — just consuming the same signals in more places
