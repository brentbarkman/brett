import { useEffect, useState } from "react";
import { getTodayUTC } from "@brett/business";

/**
 * Returns the current UTC day-start ISO string. Stable across re-renders
 * within the same UTC day; changes when the day rolls over.
 *
 * Use as a `useMemo` dep to refresh date-derived values (query bounds,
 * counters) so they don't go stale when the desktop app stays open past
 * midnight. Re-checks on window focus and on a 60s interval.
 */
export function useTodayKey(): string {
  const [todayKey, setTodayKey] = useState(() => getTodayUTC().toISOString());

  useEffect(() => {
    const check = () => {
      const next = getTodayUTC().toISOString();
      setTodayKey((prev) => (prev === next ? prev : next));
    };
    window.addEventListener("focus", check);
    const interval = setInterval(check, 60_000);
    return () => {
      window.removeEventListener("focus", check);
      clearInterval(interval);
    };
  }, []);

  return todayKey;
}
