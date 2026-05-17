// scripts/backgrounds/unsplash-queries.ts
//
// Per-slot search definitions for the wallpaper library.
//
// Design rules:
//
// 1. SEGMENT defines color story + light direction (unchanged).
//      dawn       — cool/pastel, low directional light, haze
//      morning    — bright, clear, optimistic, fresh
//      afternoon  — warm mid-day clarity
//      goldenHour — amber, low-angle warm
//      evening    — cooling, twilight blues/violets
//      night      — deep, low chroma, stars/moonlit
//
// 2. TIER varies MOOD ONLY, not visual complexity.
//      light      — airy, open horizons, distant subject, breathing room
//      moderate   — balanced, mid-distance, layered (mountains/fog bands)
//      packed     — grounded, intimate, close atmospheric subject
//      → A "packed day" wallpaper is NOT busier or more dramatic. It is
//        closer / softer / more enveloping so the user reads the UI
//        without fighting the photo. Drama was the old failure mode.
//
// 3. COMPOSITION terms bias every query toward dual-crop survival
//    (16:9 desktop + 9:19.5 iOS portrait):
//      - "minimal", "atmospheric", "soft light", "haze", "negative space"
//      - top-to-bottom interest (skies + foreground, not horizontal-bias)
//      - one clear subject or one clear mood
//      - avoid "dramatic", "intense", "vivid", "electric", "chaotic"
//
// 4. The sourcing script pairs every query with order_by=editorial
//    (Unsplash's curated set), which has a far higher photobook hit
//    rate than relevance-sorted stock.

export const QUERY_BY_CATEGORY: Record<string, string> = {
  // ── DAWN ─────────────────────────────────────────────────────────────
  "dawn/light":         "misty lake dawn pastel calm minimal",
  "dawn/moderate":      "layered fog hills dawn atmospheric soft",
  "dawn/packed":        "forest mist dawn intimate soft light",

  // ── MORNING ──────────────────────────────────────────────────────────
  "morning/light":      "open meadow morning soft light minimal",
  "morning/moderate":   "lakeside morning calm reflection atmospheric",
  "morning/packed":     "pine forest morning soft light haze",

  // ── AFTERNOON ────────────────────────────────────────────────────────
  "afternoon/light":    "desert plain afternoon soft warm minimal",
  "afternoon/moderate": "rolling hills afternoon warm light atmospheric",
  "afternoon/packed":   "tropical foliage afternoon soft light intimate",

  // ── GOLDEN HOUR ──────────────────────────────────────────────────────
  "goldenHour/light":   "calm ocean golden hour amber minimal",
  "goldenHour/moderate":"wheat field golden hour soft warm",
  "goldenHour/packed":  "forest golden hour soft rays intimate",

  // ── EVENING ──────────────────────────────────────────────────────────
  "evening/light":      "still water twilight blue pastel minimal",
  "evening/moderate":   "mountain ridge twilight layered atmospheric",
  "evening/packed":     "coastal evening soft moody intimate",

  // ── NIGHT ────────────────────────────────────────────────────────────
  "night/light":        "starry sky open landscape calm minimal",
  "night/moderate":     "moonlit lake mountains atmospheric soft",
  "night/packed":       "milky way mountain peaceful long exposure",
};
