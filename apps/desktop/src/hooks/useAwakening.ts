import { useState, useEffect } from "react";

export type AwakeningStatus = "pending" | "play" | "skip";

interface UseAwakeningArgs {
  /** Combined readiness: the caller ANDs together every precondition it wants
   *  to wait on (e.g. CDN base URL resolved + real wallpaper painted + primary
   *  content query hydrated). The hook flips "pending" → "play" the first
   *  render this is true. */
  ready: boolean;
  /** Safety cap from mount: if `ready` never becomes true within this window,
   *  transition to "play" anyway so a slow query can't strand the user on a
   *  black cover. Default 2200ms. */
  maxWaitMs?: number;
}

interface UseAwakeningResult {
  /** Tri-state decision:
   *  - "pending": still waiting on readiness. Caller keeps the cover opaque
   *     so a partial paint doesn't flash through.
   *  - "play":    awakening should play. Caller triggers the reveal.
   *  - "skip":    no awakening (already played this session, or prefers
   *     reduced motion). Caller renders UI immediately. */
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

const DEFAULT_MAX_WAIT_MS = 2200;

/**
 * Gates the cold-launch Ken Burns reveal. Resolves to "skip" when this
 * session has already played an awakening or the user prefers reduced
 * motion; otherwise waits for `ready` (or the cap) then resolves to "play".
 */
export function useAwakening({
  ready,
  maxWaitMs = DEFAULT_MAX_WAIT_MS,
}: UseAwakeningArgs): UseAwakeningResult {
  const [status, setStatus] = useState<AwakeningStatus>(() => {
    if (SESSION_PLAYED || prefersReducedMotion()) return "skip";
    return "pending";
  });

  useEffect(() => {
    if (status !== "pending") return;
    if (!ready) return;
    SESSION_PLAYED = true;
    setStatus("play");
  }, [ready, status]);

  useEffect(() => {
    if (status !== "pending") return;
    const timer = setTimeout(() => {
      setStatus((prev) => {
        if (prev !== "pending") return prev;
        SESSION_PLAYED = true;
        return "play";
      });
    }, maxWaitMs);
    return () => clearTimeout(timer);
    // Intentional: arm the cap once from mount. maxWaitMs is expected to be
    // stable; re-running on change would extend the window each time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { status };
}
