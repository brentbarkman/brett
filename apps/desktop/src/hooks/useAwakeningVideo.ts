import { useState } from "react";
import manifest from "../data/awakening-manifest.json";

type Segment = "dawn" | "morning" | "afternoon" | "goldenHour" | "evening" | "night";

interface UseAwakeningVideoArgs {
  baseUrl: string;
  segment: Segment;
}

interface UseAwakeningVideoResult {
  shouldPlay: boolean;
  /** Sources in priority order — pass directly to <video> as multiple <source> children. */
  videoUrls: string[];
}

/** Module-level flag — once true, no further awakenings this session. */
let SESSION_PLAYED = false;

/** Test helper. Do not call from app code. */
export function _resetAwakeningSessionFlag() {
  SESSION_PLAYED = false;
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function useAwakeningVideo({
  baseUrl,
  segment,
}: UseAwakeningVideoArgs): UseAwakeningVideoResult {
  // Decide ONCE per hook instance — useState lazy initializer captures the
  // decision at mount time so re-renders don't replay it.
  const [decision] = useState<UseAwakeningVideoResult>(() => {
    if (SESSION_PLAYED) return { shouldPlay: false, videoUrls: [] };
    if (prefersReducedMotion()) return { shouldPlay: false, videoUrls: [] };
    if (!baseUrl) return { shouldPlay: false, videoUrls: [] };

    const entry = (manifest as { videos: Record<string, { mp4: string; webm: string }> }).videos[segment];
    if (!entry) return { shouldPlay: false, videoUrls: [] };

    SESSION_PLAYED = true;
    return {
      shouldPlay: true,
      // WebM first (smaller, modern), MP4 fallback. <video> picks the first playable source.
      videoUrls: [`${baseUrl}/${entry.webm}`, `${baseUrl}/${entry.mp4}`],
    };
  });

  return decision;
}
