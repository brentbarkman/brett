import { useEffect, useState } from "react";
import {
  applyHysteresis,
  getCachedLuminance,
  luminanceFromHex,
  sampleLuminanceForUrl,
} from "../lib/backgroundLuminance";

interface UseBackgroundLuminanceInput {
  /** Wallpaper photo URL when the user is on photography/abstract.
   *  Empty string while the config + initial image are still loading.
   *  Ignored when `solidHex` is set. */
  imageUrl?: string;
  /** `#RRGGBB` for the solid-color wallpaper mode. Takes precedence
   *  over `imageUrl`; the user explicitly picked this color so we
   *  derive luminance synchronously rather than going through the
   *  canvas decode path. */
  solidHex?: string | null;
}

interface UseBackgroundLuminanceResult {
  /** WCAG relative luminance (0..1) of the visible wallpaper surface.
   *  Defaults to 0 (dark) before the first sample resolves so prose
   *  stays white-on-shadow during cold launch. */
  luminance: number;
  /** Hysteretic flag — true when the wallpaper is bright enough that
   *  prose should switch to dark text. Driven through `applyHysteresis`
   *  so rotation between two borderline-bright photos doesn't flicker. */
  isLight: boolean;
}

/**
 * Track the luminance of whatever surface the briefing prose sits on:
 * a photo (sampled via Canvas, cached in localStorage) or a solid color
 * (derived synchronously from hex). Mirrors the iOS pipeline in
 * `BackgroundService.currentWashIsLight`: cache-hit sync, async on miss,
 * hysteretic flip with a 0.55..0.65 deadband.
 *
 * Performance:
 *   - cache hit → sync state set, no async work
 *   - cache miss → one Image decode + one 1×1 canvas readback (~5–15ms)
 *   - solid color → synchronous; no I/O, no canvas
 *   - empty input → no-op (cold launch before /config returns)
 *   - in-flight dedup → identical URLs from re-renders share one decode
 *   - sample failure (CORS, network) → keep previous flag, no thrash
 *
 * The hook only schedules async work on input change, so a typing
 * storm in the omnibar (or any other re-render) doesn't re-sample.
 */
export function useBackgroundLuminance({
  imageUrl,
  solidHex,
}: UseBackgroundLuminanceInput): UseBackgroundLuminanceResult {
  // Seed from whichever input is active so the first paint already has
  // the right answer for any wallpaper we can resolve synchronously
  // (cached photos or solid colors). `useState` initializer runs once
  // per mount; the effect below catches subsequent rotations.
  const initial = resolveSync(imageUrl, solidHex);
  const [luminance, setLuminance] = useState<number>(initial ?? 0);
  const [isLight, setIsLight] = useState<boolean>(
    initial !== null && applyHysteresis(false, initial),
  );

  useEffect(() => {
    // Solid path — synchronous; no canvas, no network.
    if (solidHex) {
      const lum = luminanceFromHex(solidHex);
      if (lum === null) return;
      setLuminance(lum);
      setIsLight((prev) => applyHysteresis(prev, lum));
      return;
    }

    if (!imageUrl) return;

    // Sync cache hit: skip the async path entirely.
    const cached = getCachedLuminance(imageUrl);
    if (cached !== null) {
      setLuminance(cached);
      setIsLight((prev) => applyHysteresis(prev, cached));
      return;
    }

    // Async miss. Capture the URL we asked about so a stale resolve
    // (the user rotated before our sample landed) is ignored.
    let cancelled = false;
    sampleLuminanceForUrl(imageUrl)
      .then((sampled) => {
        if (cancelled) return;
        setLuminance(sampled);
        setIsLight((prev) => applyHysteresis(prev, sampled));
      })
      .catch(() => {
        // Stay on the previous flag — losing one sample is fine,
        // the user gets white-on-shadow which works for most photos.
      });

    return () => {
      cancelled = true;
    };
  }, [imageUrl, solidHex]);

  return { luminance, isLight };
}

/** Compute the synchronously-knowable luminance for an input, or null
 *  when we'd need to fire an async decode. Solid hex always resolves
 *  synchronously; photo URLs resolve only when the cache is hot. */
function resolveSync(imageUrl: string | undefined, solidHex: string | null | undefined): number | null {
  if (solidHex) return luminanceFromHex(solidHex);
  if (imageUrl) return getCachedLuminance(imageUrl);
  return null;
}

