/**
 * Background-luminance sampler — chooses light vs. dark text color for
 * content that sits directly on the wallpaper photo (the briefing prose
 * on Today, primarily). Mirrors iOS `WashColorSampler` + `BackgroundService`
 * so the two clients reach the same decision for the same photo URL.
 *
 * Pipeline:
 *   1. `sampleLuminanceForUrl(url)` — draws the photo's 50–65% vertical
 *      band into a 1×1 OffscreenCanvas, reads back one pixel, runs WCAG
 *      relative luminance. ~5–15ms on cache miss, free on hit.
 *   2. localStorage cache keyed by URL — survives reload; the manifest
 *      is small enough (~36 entries) that growth is a non-issue. Cache
 *      is NOT user-scoped: the luminance of a photo is the same for
 *      every user, so scoping would just multiply storage with no
 *      payoff.
 *   3. `applyHysteresis` — turns the continuous luminance into a
 *      `isLight: boolean` with a 0.55..0.65 deadband. Prevents flicker
 *      between two rotation neighbors hovering near the threshold.
 *
 * The pure helpers (`linearize`, `relativeLuminance`, `applyHysteresis`,
 * cache read/write) are exported so `__tests__/backgroundLuminance.test.ts`
 * can pin the math without booting a DOM.
 */

const CACHE_KEY = "brett.background.luminance.v1";

/** Threshold above which we flip white → dark text. Calibrated against
 *  the real manifest: most "moody" photos land 0.05–0.25, a few
 *  "afternoon" / "golden hour" mid-brights land 0.40–0.55, and only
 *  truly sunlit shots clear 0.55+. 0.40 puts the flip right at the
 *  point where mid-bright photos start to struggle for white text. */
export const IS_LIGHT_THRESHOLD_HIGH = 0.40;
/** Threshold below which we flip dark → white text. The gap between
 *  this and HIGH is the deadband. */
export const IS_LIGHT_THRESHOLD_LOW = 0.30;

/** Convert an sRGB channel value (0..1) to its WCAG linear-light
 *  equivalent. Piece-wise: linear/12.92 below the 0.03928 elbow,
 *  ((c + 0.055)/1.055)^2.4 above. */
export function linearize(c: number): number {
  const clamped = Math.max(0, Math.min(1, c));
  if (clamped <= 0.03928) return clamped / 12.92;
  return Math.pow((clamped + 0.055) / 1.055, 2.4);
}

/** WCAG relative luminance (0..1) from sRGB components in 0..1.
 *  Sorting: green carries the most weight, then red, then blue. */
export function relativeLuminance(r: number, g: number, b: number): number {
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
}

/** Luminance of a `#RRGGBB` (or `RRGGBB`, with/without leading `#`)
 *  hex color, or null if the string can't be parsed. Used for the
 *  solid-color wallpaper path — the user picked the color, so we
 *  derive luminance synchronously rather than going through Canvas. */
export function luminanceFromHex(hex: string): number | null {
  let cleaned = hex.trim();
  if (cleaned.startsWith("#")) cleaned = cleaned.slice(1);
  if (cleaned.length !== 6) return null;
  const value = Number.parseInt(cleaned, 16);
  if (Number.isNaN(value)) return null;
  const r = ((value >> 16) & 0xff) / 255;
  const g = ((value >> 8) & 0xff) / 255;
  const b = (value & 0xff) / 255;
  return relativeLuminance(r, g, b);
}

/** Apply the hysteretic isLight flag against a new luminance reading.
 *  Pure — no I/O — so tests can pin the deadband contract without
 *  building a hook. */
export function applyHysteresis(prevIsLight: boolean, luminance: number): boolean {
  if (prevIsLight) {
    return luminance >= IS_LIGHT_THRESHOLD_LOW;
  }
  return luminance > IS_LIGHT_THRESHOLD_HIGH;
}

// ---------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------

interface LuminanceCache {
  [url: string]: number;
}

function readAll(): LuminanceCache {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? (parsed as LuminanceCache) : {};
  } catch {
    return {};
  }
}

function writeAll(cache: LuminanceCache): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    /* quota — silent, sampler will re-derive next session */
  }
}

/** Synchronous cache read. Returns nullish for first-sight photos
 *  (caller stays on the default until the async sample lands). */
export function getCachedLuminance(url: string): number | null {
  if (!url) return null;
  const cache = readAll();
  const value = cache[url];
  return typeof value === "number" ? value : null;
}

/** Persist a sampled luminance for `url`. Called by the sampler after
 *  a successful decode + readback. */
export function setCachedLuminance(url: string, value: number): void {
  if (!url) return;
  const cache = readAll();
  cache[url] = value;
  writeAll(cache);
}

// ---------------------------------------------------------------------
// Canvas sampler (DOM-only)
// ---------------------------------------------------------------------

/** Promise-cache so a burst of identical-URL requests (a hook
 *  re-mount + an effect re-run) doesn't fire N decodes. Keys evict
 *  themselves on resolve. */
const inFlight = new Map<string, Promise<number>>();

/** Decode `url` and compute the WCAG luminance of its 50–65%
 *  vertical band. Hits localStorage first; on miss, draws the band
 *  into a 1×1 canvas and reads one pixel back. Resolves to a
 *  luminance in 0..1.
 *
 *  Throws-via-rejection on:
 *    - empty URL
 *    - image load failure (404, network)
 *    - CORS taint (storage origin doesn't allow cross-origin reads)
 *  The hook treats any rejection as "stay on the current isLight";
 *  the user never sees a broken state, just no swap. */
export async function sampleLuminanceForUrl(url: string): Promise<number> {
  if (!url) throw new Error("empty url");

  const cached = getCachedLuminance(url);
  if (cached !== null) return cached;

  const existing = inFlight.get(url);
  if (existing) return existing;

  const promise = decodeAndSample(url).then((value) => {
    setCachedLuminance(url, value);
    inFlight.delete(url);
    return value;
  }).catch((err) => {
    inFlight.delete(url);
    throw err;
  });
  inFlight.set(url, promise);
  return promise;
}

async function decodeAndSample(url: string): Promise<number> {
  const img = new Image();
  // CORS-anonymous so canvas readback is permitted when the storage
  // server is on a different origin and returns the right ACAO header.
  // Skipped for data:/blob: URIs — both are same-origin by spec and
  // setting crossOrigin can taint the canvas in some engines.
  if (!/^(data|blob):/i.test(url)) {
    img.crossOrigin = "anonymous";
  }
  img.decoding = "async";
  img.src = url;
  if (typeof img.decode === "function") {
    await img.decode();
  } else {
    await waitForLoad(img);
  }

  // Draw the 50–65% vertical band into a 1×1 canvas. CoreGraphics
  // on iOS does the average for us during the down-sample; the
  // browser's canvas does the same. Cheaper than reading the full
  // image and averaging in JS.
  const bandTop = Math.floor(img.naturalHeight * 0.50);
  const bandHeight = Math.max(1, Math.floor(img.naturalHeight * 0.15));

  const ctx = makeCanvasContext(1, 1);
  if (!ctx) throw new Error("2d context unavailable");
  ctx.drawImage(
    img,
    0, bandTop, img.naturalWidth, bandHeight,
    0, 0, 1, 1,
  );
  const data = ctx.getImageData(0, 0, 1, 1).data;
  const r = data[0] / 255;
  const g = data[1] / 255;
  const b = data[2] / 255;
  return relativeLuminance(r, g, b);
}

function waitForLoad(img: HTMLImageElement): Promise<void> {
  return new Promise((resolve, reject) => {
    if (img.complete) {
      // `complete` is true after a successful load AND after an error.
      // Disambiguate by naturalWidth — 0 means the browser couldn't
      // produce pixels for this image. Resolve/reject directly so the
      // sampler doesn't hang waiting for a load event that already fired.
      if (img.naturalWidth > 0) resolve();
      else reject(new Error("image load failed"));
      return;
    }
    img.addEventListener("load", () => resolve(), { once: true });
    img.addEventListener("error", () => reject(new Error("image load failed")), { once: true });
  });
}

/** Prefer OffscreenCanvas (no DOM insertion, no layout) when the
 *  runtime supports it; fall back to a detached <canvas> element. The
 *  fallback is needed in older WebKit and in jsdom.
 *
 *  Returns the 2D context directly because `OffscreenCanvas.getContext`
 *  has a union return type that includes ImageBitmapRenderingContext —
 *  callers want a CanvasRenderingContext2D-shaped surface either way.
 *  The narrow happens here so the hot path stays readable. */
type Canvas2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function makeCanvasContext(width: number, height: number): Canvas2D | null {
  if (typeof OffscreenCanvas !== "undefined") {
    const canvas = new OffscreenCanvas(width, height);
    return canvas.getContext("2d") as OffscreenCanvasRenderingContext2D | null;
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas.getContext("2d");
}
