# Background System Audit & Uplift

**Date:** 2026-04-14
**Status:** Design — pending approval
**Relates to:** [`2026-04-01-living-background-design.md`](2026-04-01-living-background-design.md) (the original Living Background spec)

## Problem

The Living Background system (time-of-day × busyness-tier rotation, 54+ curated photographs, smart selection) is a core part of Brett's identity. In practice:

- **Some images are A+**, others are distracting, muddy, or fight content legibility. The average quality drags the peak down.
- **Glass cards read poorly on bright backgrounds.** Current `bg-black/30` behind `backdrop-blur-xl` is too transparent against bright skies and ocean scenes. The fix was approved 8 days ago but never shipped.
- **The app-launch "awakening" moment is good but static.** Crossfading from previous segment to current over 1.5s is cinematic but ultimately feels like an image swap. Brett could own this moment more.

This spec covers all three in one arc because they share a surface and shipping them together lets us judge the whole environment at once.

## Goals

1. **Raise the image floor.** Every photo in rotation should be "I'd screenshot this." No Bs.
2. **Fix legibility at the source.** Content surfaces should be legible on any background, including bright afternoon skies, without needing photo-specific exceptions.
3. **Turn app launch into a moment.** Ambient, restrained, one-time-per-session.

## Non-Goals

- Replacing the time × busyness taxonomy. It works, we keep it.
- Per-user custom backgrounds / user uploads. Out of scope; future.
- Video for every rotation (explicitly rejected — see "Alternatives considered").
- Live camera / webcam / real-world feeds. Not Brett.

---

## Phase 1 — The Cut & Replace

### Intent

Tighten the curated pool to an A+ set. Keep the 18-category taxonomy (6 segments × 3 tiers), but ensure **every image** in each category is photograph-of-the-year-tier.

### Process

**Step 1 — Score the existing 54.** I walk through every image with the user in the desktop UI, scoring each on:
- **Legibility zones** — does the left sidebar area and top-center (where content cards sit) have enough low-contrast fill to host glass cards?
- **Distraction** — does the eye get pulled to a face, a logo, a weird shape?
- **Tone match** — does it feel like the time-of-day + tier it's slotted into?
- **Overall quality** — is the image actually beautiful, or just okay?

Verdict per image: **Keep**, **Replace**, or **Cut** (if the category has enough good images we can just have fewer).

**Step 2 — Source replacements via Unsplash API.** User provides API key. We build a lightweight sourcing flow: given a category (e.g., "golden hour, packed tier"), search Unsplash with a curated query prompt, review candidates together, pick 1–3 keepers per replacement slot.

**Step 3 — Upload + regenerate manifest.** A one-shot script takes the final image pool, optimizes to WebP at **2560×1440** (q=80), uploads to Railway Object Storage, regenerates the manifest JSON. Rationale: the background sits behind heavy blur + scrim, so 4K is wasted bytes. 2560 matches the current spec.

### Constraints

- **Pool size: A+ only, minimum 2 per category.** No filler images to pad a category to 3. If a category is genuinely thin after the cut, we source replacements from Unsplash (Step 2) until we clear the A+ bar. Tiny categories (2 images) are acceptable.
- **Resolution / file size:** Keep under current total footprint (~22 MB for photography set). WebP q=80.
- **Licensing:** Unsplash's license covers this use. Track source/photographer in manifest (no UI attribution this pass; see below).
- **Abstract set:** Out of scope for this pass. Remains as-is.

### Attribution

Record photographer + source URL in the manifest for every image, for future traceability. **No UI surfacing** in V1 — deferred.

---

## Phase 2 — Glass & Scrim Polish

### Intent

Make every content surface legible on any background without relying on the image to cooperate.

### Changes

**1. Bump content-card opacity.** Every primary content card (`bg-black/30` currently) becomes `bg-black/40`. Audit list:

- `CalendarTimeline.tsx:177`
- `ThingsList.tsx` (main list container)
- `ThingsEmptyState.tsx`
- `UpNextCard.tsx`
- `ScoutsRoster.tsx`
- `InboxView` / `InboxItemRow` — verify
- Any other primary panel that sits directly on the background

**Interactive / elevated states** stay at `bg-black/40` → `bg-black/50` on hover (one step up from base) to preserve hierarchy.

**2. Add a radial vignette scrim layer.** A new layer between `LivingBackground` and app content. This is NOT per-card — it's a single full-viewport overlay that darkens the outside and softens the center just enough for cards to float over.

```
Shape:     radial-gradient(ellipse at 30% 45%, transparent 0%, rgba(0,0,0,0.25) 75%)
Position:  30% from left, 45% from top (biases toward where content lives; sidebar is on the left)
Z-index:   above LivingBackground image/video layer, below all app chrome
Blend:     normal (not multiply — too muddy)
Animation: STATIC. No pulse, no breath. Ambient chrome only.
```

This gives us:
- **Bright afternoon sky:** scrim deepens the edges, content area stays lighter but gets `/40` glass for contrast
- **Dark forest:** scrim has almost no visible effect; `/40` is fine
- **Any photo:** card edges always have enough contrast with the background around them

**3. Restructure the existing linear vignettes:**
   - **Drop the bottom portion** of the vertical gradient — the radial scrim covers the bottom-edge darkening and doubling up muddies night scenes.
   - **Reduce the top portion** from `to-black/40` to `to-black/30` — the top darkening exists to give contrast behind the macOS traffic-light buttons; too dark when the radial scrim is under it.
   - **Keep the left sidebar scrim** (312px horizontal gradient) — serves a distinct purpose (darkening behind fixed nav chrome) that the radial doesn't replicate.
   - **Verify on night/dark scenes** during implementation. If any scene reads too dark, tune the radial's peak opacity down from `0.25` to `0.20`.

### Verification

- Test matrix: walk the app with the background pinned to one image from each of (bright sky, dark forest, muted abstract, bright abstract, golden hour warm, night navy). Every card type (list items, calendar events, empty states, chat bubble, settings panel) must be legible at a glance.
- Run the legibility check in Settings → Appearance with a "cycle through all images" debug tool (new, simple button). Drop at ship.


---

## Phase 3 — The Awakening Moment

### Intent

Turn app cold-launch into a 2.5–3s cinematic beat. One hero video per time segment (not per-tier — 6 videos total, not 18). Plays once on launch, settles into the selected still, UI animates in over the resolved still.

### The Flow

```
0.0s  — App renders; video begins autoplaying (muted, inline)
0.0–2.5s — Video plays. UI chrome is hidden or at very low opacity.
2.5s — Video reaches designed "rest frame." Video element pauses (visually: freeze).
       Crossfade from video's last frame to the selected still image for the current category.
2.5–3.0s — UI animates in (sidebar slide, content fade, staggered card entry).
```

Key design choices:

- **6 videos, one per time segment.** Dawn, Morning, Afternoon, Golden Hour, Evening, Night. All tiers within a segment share the same launch video. Simpler, 10× less asset weight.
- **The rest frame is NOT a specific still from the pool.** The video terminates on its own final frame, which is visually continuous with *some* still in the pool. Post-video we crossfade (300–500ms) to the rotation-selected still. This lets rotation stay smart (tier-aware) even though the video is shared across tiers.
- **Trigger: cold launch only.** NOT tab switch, NOT returning from sleep, NOT mid-session time-segment shifts. Once per session.
- **Fallback: instant still, no video.** If the video file hasn't loaded within ~400ms, skip it. Use existing 1.5s awakening crossfade instead. The video is a privilege, not a requirement.

### Asset specs

- **Duration:** 2.5s each (+ 0.5s held freeze frame before UI settles = 3.0s total)
- **Resolution:** 2560×1440 (retina sensible). Downscale for smaller displays.
- **Format:** H.265/HEVC in MP4 (Electron/Chromium supports); WebM/VP9 fallback.
- **Target size:** ≤ 3 MB per clip, ≤ 18 MB for the set of 6.
- **Motion:** Slow, breathing, ambient. Think: mist drifting over water, clouds moving slowly across sky, light shifting on mountains. NOT tracking shots, NOT birds flying across, NOT anything that pulls the eye.
- **Rest frame:** Each video's final frame is its own "still." No need to match a specific photo in the pool.

### Sourcing — Pexels (licensed stock)

**Source:** Pexels Video API. Free, permissive license, good catalog for ambient nature footage.

Process per segment:
1. Search Pexels with a curated query per segment (e.g., "misty lake dawn slow motion", "ocean waves sunset ambient").
2. Shortlist 5–10 candidates per segment, review together.
3. Trim each to 2.5s with a "settle into stillness" end-point (fade out motion, land on a composed frame).
4. Ensure the final frame is legible-enough to host the scrim+glass treatment.
5. Encode H.265 MP4 + VP9 WebM fallback, upload to Railway Object Storage.

If Pexels doesn't yield quality across all 6 segments after a good-faith pass, we evaluate AI-generated (Runway/Veo) as a targeted fallback for the thin ones. Not leading with AI.

### Platform notes

- Electron/Chromium handles HEVC + H.264 cleanly.
- `<video autoplay muted playsinline preload="auto">` — no controls, no sound, no user interaction needed.
- The existing `VideoBackground.tsx` component already implements dual-slot fade; extend it for the "video → still handoff" pattern rather than building new.

### Open questions

- **Should we add a subtle logo reveal moment over the video?** E.g., Brett mark fades up at 0.3s and fades out by 1.8s. My take: no for V1 — we already have a splash in the Electron chrome. Don't double-brand.
- **Should this respect a "prefers-reduced-motion" setting?** Yes, absolutely. Instant still + existing 1.5s awakening when reduced motion is on.

---

## Alternatives Considered (and rejected)

### Video everywhere (user's original ambitious idea, full version)

Replace all 54 still images with videos that play continuously. **Rejected** because:

- **Doesn't solve legibility** — motion behind text is *harder* to read, not easier.
- **Asset sourcing infeasible** at the quality bar required across 54 category combinations.
- **Asset weight** scales ~10× (200–500 MB vs. current ~22 MB).
- **Apple doesn't do this in productivity surfaces.** Apple TV screensavers are continuous because you're not reading anything on them. Mail, Notes, Reminders all have static chrome.

### Per-card radial vignette

Put a radial scrim behind each individual card instead of one full-viewport scrim. **Rejected** because it creates visible "halos" around each card (looks like a drop-shadow experiment), doesn't compose well when cards overlap (Omnibar + backgrounds), and costs more paint. The full-viewport scrim is cleaner and composes with everything downstream.

### Time-segment transition video mid-session

When the user is in the app at 5pm and the time segment shifts to golden hour, play a transition video. **Deferred**, not rejected. Worth doing later, but not in this pass — risks feeling surprise-y/flashy during focused work.

---

## Sequencing & Dependencies

**Recommended build order** (each ships independently; we judge the whole after each):

1. **Phase 2 first (glass & scrim polish).** Lowest effort, highest leverage, doesn't depend on image changes. Ship this and we'll already feel a step change on every existing background.
2. **Phase 1 second (audit & replace).** With the scrim in place, some images that previously felt borderline may actually be fine now. Audit after scrim gives us cleaner judgment.
3. **Phase 3 last (awakening moment).** Polish, not structural. Requires asset sourcing, which is the longest-lead item.

**Blocking dependencies:**
- Phase 1 Step 3 (upload) requires: Railway Object Storage bucket access (already live), manifest script (to write).
- Phase 3 requires: video assets (Unsplash API only helps for Phase 1; video sourcing is separate — AI generation tools or stock video service).

---

## Success Criteria

**Phase 2:**
- Take 5 screenshots: bright sky, dark forest, golden hour, night, abstract bright. Content text readable at a glance in all five without squinting.
- No regressions on dark backgrounds (we don't over-dim them).

**Phase 1:**
- The full pool walks-through feels "good → better → best," never "hmm" or "why is this here."
- We can show the app to a designer-friend and they don't clock any specific image as weak.

**Phase 3:**
- App launch feels like a moment, not a loading screen.
- Reduced-motion users get a perfect non-video experience.
- Asset weight ≤ 18 MB for video set; no measurable cold-start regression.

---

## Decisions Locked

Originally open questions, now resolved:

| # | Decision |
|---|----------|
| 1 | Pool size: A+ only, **minimum 2 per category**. No filler. |
| 2 | Attribution: record in manifest, **no UI surfacing this pass**. |
| 3 | Scrim animation: **static**. No pulse. |
| 4 | Linear vignettes: **drop bottom**, **reduce top to `to-black/30`**, **keep left sidebar scrim**. Verify on night scenes. |
| 5 | Phase 3 sourcing: **Pexels** (licensed stock video API). AI-generated only as targeted fallback. |
| 6 | Reduced-motion: confirmed yes — instant still + existing 1.5s awakening crossfade when `prefers-reduced-motion: reduce`. |
