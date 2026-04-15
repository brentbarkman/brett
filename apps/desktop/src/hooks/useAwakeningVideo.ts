import { useEffect, useState } from "react";
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

const NO_PLAY: UseAwakeningVideoResult = { shouldPlay: false, videoUrls: [] };

/**
 * Decides whether to play the awakening video. Uses useEffect (not a useState
 * initializer with side effects) so it re-evaluates correctly when baseUrl
 * arrives async from useAppConfig. Sets state at most once per session: from
 * NO_PLAY → {shouldPlay: true} when conditions are met, never the reverse.
 */
export function useAwakeningVideo({
  baseUrl,
  segment,
}: UseAwakeningVideoArgs): UseAwakeningVideoResult {
  const [decision, setDecision] = useState<UseAwakeningVideoResult>(NO_PLAY);

  useEffect(() => {
    if (decision.shouldPlay) return; // already decided to play; lock the value
    if (SESSION_PLAYED) return; // another instance played this session
    if (prefersReducedMotion()) return;
    if (!baseUrl) return; // wait for storage URL

    const entry = (manifest as { videos: Record<string, { mp4: string; webm: string }> }).videos[segment];
    if (!entry) return;

    SESSION_PLAYED = true;
    setDecision({
      shouldPlay: true,
      // WebM first (smaller, modern), MP4 fallback. <video> picks the first playable source.
      videoUrls: [`${baseUrl}/${entry.webm}`, `${baseUrl}/${entry.mp4}`],
    });
  }, [baseUrl, segment, decision.shouldPlay]);

  return decision;
}
