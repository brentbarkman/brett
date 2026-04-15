import { useState, useEffect } from "react";

export type AwakeningStatus = "pending" | "play" | "skip";

interface UseAwakeningArgs {
  /** Storage base URL (from useAppConfig). The cold-launch reveal waits
   *  for this to resolve so the real wallpaper is available before Ken
   *  Burns starts. */
  baseUrl: string;
}

interface UseAwakeningResult {
  /** Tri-state decision:
   *  - "pending": still waiting for baseUrl. Caller keeps the cover
   *     opaque so a partial paint doesn't flash through.
   *  - "play":    awakening should play. Caller triggers the reveal.
   *  - "skip":    no awakening (already played this session, or
   *     prefers-reduced-motion). Caller renders UI immediately. */
  status: AwakeningStatus;
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
 * Gates the cold-launch Ken Burns reveal. Resolves to "skip" when this
 * session has already played an awakening or the user prefers reduced
 * motion; otherwise waits for baseUrl then resolves to "play".
 */
export function useAwakening({ baseUrl }: UseAwakeningArgs): UseAwakeningResult {
  const [status, setStatus] = useState<AwakeningStatus>(() => {
    if (SESSION_PLAYED || prefersReducedMotion()) return "skip";
    return "pending";
  });

  useEffect(() => {
    if (status !== "pending") return;
    if (!baseUrl) return;
    SESSION_PLAYED = true;
    setStatus("play");
  }, [baseUrl, status]);

  return { status };
}
