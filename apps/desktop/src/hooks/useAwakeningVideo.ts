import { useEffect, useState } from "react";
import manifest from "../data/awakening-manifest.json";

type Segment = "dawn" | "morning" | "afternoon" | "goldenHour" | "evening" | "night";

interface UseAwakeningVideoArgs {
  baseUrl: string;
  segment: Segment;
}

export type AwakeningStatus = "pending" | "play" | "skip";

interface UseAwakeningVideoResult {
  /** Tri-state decision so callers can show a black cover during "pending"
   *  (avoiding a flash of LivingBackground before the video mounts) and
   *  immediately render LivingBackground on "skip" (no cover needed). */
  status: AwakeningStatus;
  /** Sources in priority order — only meaningful when status === "play". */
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

/**
 * Decides whether to play the awakening video. Returns one of three statuses:
 *
 * - "skip": resolved synchronously when SESSION_PLAYED or reduced motion is
 *   active. Caller should render LivingBackground normally with no cover.
 * - "pending": waiting for baseUrl to resolve from useAppConfig. Caller
 *   should render a black cover so LivingBackground doesn't flash through.
 * - "play": video is ready to mount. Caller renders <AwakeningVideo>.
 */
export function useAwakeningVideo({
  baseUrl,
  segment,
}: UseAwakeningVideoArgs): UseAwakeningVideoResult {
  const [decision, setDecision] = useState<UseAwakeningVideoResult>(() => {
    // Synchronously resolvable: skip the awakening if session already played
    // or reduced motion is set. This avoids any black-cover flash for users
    // who don't get the awakening anyway.
    if (SESSION_PLAYED || prefersReducedMotion()) {
      return { status: "skip", videoUrls: [] };
    }
    return { status: "pending", videoUrls: [] };
  });

  useEffect(() => {
    if (decision.status !== "pending") return; // already resolved
    if (!baseUrl) return; // wait for storage URL

    const entry = (manifest as { videos: Record<string, { mp4: string; webm: string }> }).videos[segment];
    if (!entry) {
      // No video for this segment — skip cleanly
      setDecision({ status: "skip", videoUrls: [] });
      return;
    }

    SESSION_PLAYED = true;
    setDecision({
      status: "play",
      videoUrls: [`${baseUrl}/${entry.webm}`, `${baseUrl}/${entry.mp4}`],
    });
  }, [baseUrl, segment, decision.status]);

  return decision;
}
