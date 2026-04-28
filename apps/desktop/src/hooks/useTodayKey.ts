import { useEffect, useState } from "react";
import { getTodayUTC } from "@brett/business";
import { useNow } from "./useNow";

/**
 * Returns the current UTC day-start ISO string. Stable across re-renders
 * within the same UTC day; changes when the day rolls over.
 *
 * Use as a `useMemo` dep to refresh date-derived values (query bounds,
 * counters) so they don't go stale when the desktop app stays open past
 * midnight. Re-checks on window focus and via the visibility-aware useNow
 * tick (which auto-resyncs on visibility change, covering the case where
 * the day rolled over while the app was hidden).
 */
export function useTodayKey(): string {
  const now = useNow(60_000);
  const [todayKey, setTodayKey] = useState(() => getTodayUTC().toISOString());

  useEffect(() => {
    const next = getTodayUTC().toISOString();
    setTodayKey((prev) => (prev === next ? prev : next));
  }, [now]);

  useEffect(() => {
    const check = () => {
      const next = getTodayUTC().toISOString();
      setTodayKey((prev) => (prev === next ? prev : next));
    };
    window.addEventListener("focus", check);
    return () => window.removeEventListener("focus", check);
  }, []);

  return todayKey;
}
