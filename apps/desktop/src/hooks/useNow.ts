import { useEffect, useRef, useState } from "react";

interface UseNowOptions {
  /**
   * If true, the first tick aligns to the next minute boundary (so a 60s
   * interval ticks at :00 of every minute) before falling into the steady
   * cadence. Useful for clocks displaying HH:MM.
   */
  alignToMinuteBoundary?: boolean;
}

/**
 * A current-time `Date` that re-renders on a fixed cadence and pauses while
 * the document is hidden. On `visibilitychange → visible`, it immediately
 * re-syncs and resumes ticking.
 *
 * Why pause on hidden: Chromium throttles JS timers in hidden tabs, but the
 * Electron main window only counts as hidden when fully occluded — leaving the
 * app open behind another window in another Space keeps every "tick the clock"
 * interval running at full speed and waking the renderer 12+ times a minute.
 */
export function useNow(intervalMs: number, options: UseNowOptions = {}): Date {
  const { alignToMinuteBoundary = false } = options;
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;
    let alignTimeout: ReturnType<typeof setTimeout> | null = null;

    const start = () => {
      const fresh = new Date();
      setNow(fresh);

      if (alignToMinuteBoundary) {
        const msUntilNextMinute =
          (60 - fresh.getSeconds()) * 1000 - fresh.getMilliseconds();
        alignTimeout = setTimeout(() => {
          setNow(new Date());
          interval = setInterval(() => setNow(new Date()), intervalMs);
        }, msUntilNextMinute);
      } else {
        interval = setInterval(() => setNow(new Date()), intervalMs);
      }
    };

    const stop = () => {
      if (alignTimeout) clearTimeout(alignTimeout);
      if (interval) clearInterval(interval);
      alignTimeout = null;
      interval = null;
    };

    if (document.visibilityState === "visible") start();

    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        stop();
        start();
      } else {
        stop();
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      stop();
    };
  }, [intervalMs, alignToMinuteBoundary]);

  return now;
}

/**
 * Like `setInterval`, but pauses while the document is hidden and resumes
 * (without firing immediately) when it becomes visible again. Use when the
 * callback only matters while the user can see the UI — image rotation,
 * preload checks, etc.
 *
 * The callback can change identity across renders without resetting the
 * interval (a ref keeps the latest version).
 */
export function useVisibilityAwareInterval(
  callback: () => void,
  intervalMs: number,
): void {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (interval) return;
      interval = setInterval(() => callbackRef.current(), intervalMs);
    };
    const stop = () => {
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
    };

    if (document.visibilityState === "visible") start();

    const handleVisibility = () => {
      if (document.visibilityState === "visible") start();
      else stop();
    };

    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      stop();
    };
  }, [intervalMs]);
}
