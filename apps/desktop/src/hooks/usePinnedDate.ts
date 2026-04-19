import { useCallback, useEffect, useRef, useState } from "react";
import { useTodayKey } from "./useTodayKey";

function isSameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * Anchor date for calendar surfaces. Seeds to "now", tracks whether the
 * caller is still pinned to today (i.e. has NOT deliberately navigated to
 * another day), and snaps forward when the local day rolls over while pinned.
 *
 * Fixes the class of bug where `useState(new Date())` froze the anchor at
 * mount, so the desktop app — left open past midnight or through a
 * sleep/wake cycle — would still show yesterday's calendar.
 *
 * Pin semantics: setting the date to a value whose local day equals today
 * re-pins; any other value unpins. The caller doesn't need to manage a
 * separate `pinnedToToday` flag.
 */
export function usePinnedDate(): [Date, (d: Date) => void] {
  const [date, setDateState] = useState(() => new Date());
  const [pinned, setPinned] = useState(true);
  const todayKey = useTodayKey();

  const stateRef = useRef({ date, pinned });
  stateRef.current = { date, pinned };

  const setDate = useCallback((d: Date) => {
    setDateState(d);
    setPinned(isSameLocalDay(d, new Date()));
  }, []);

  useEffect(() => {
    if (!stateRef.current.pinned) return;
    const now = new Date();
    if (!isSameLocalDay(stateRef.current.date, now)) {
      setDateState(now);
    }
  }, [todayKey]);

  return [date, setDate];
}
