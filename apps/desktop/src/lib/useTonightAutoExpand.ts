import { useEffect, useState } from "react";

/**
 * Default open/closed state for the Today view's Tonight section.
 *
 * Rules:
 *  - Closed by default before 6pm local (the user is in mid-day mode and
 *    Tonight items are noise).
 *  - Open by default at 6pm local or later (the section becomes relevant).
 *  - Sticky user override: once the user manually toggles the section on
 *    a given day, the auto rule yields for the rest of that day. The
 *    override is keyed by the local calendar date so each day starts
 *    fresh with the auto rule.
 *
 * The hook re-evaluates every minute so the 6pm "tip over" happens
 * without a page reload.
 */
const TOUCHED_KEY_PREFIX = "brett:today.tonight.userToggled.";
const STATE_KEY_PREFIX = "brett:today.tonight.openState.";
const EVENING_HOUR = 18;
const REEVALUATE_INTERVAL_MS = 60_000;

function todayKey(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function computeDefault(now: Date = new Date()): boolean {
  return now.getHours() >= EVENING_HOUR;
}

function readPersistedOpen(key: string): boolean | null {
  try {
    const touched = window.localStorage.getItem(TOUCHED_KEY_PREFIX + key);
    if (touched !== "true") return null;
    return window.localStorage.getItem(STATE_KEY_PREFIX + key) === "true";
  } catch {
    // localStorage unavailable (private mode / iframe sandbox) — fall back
    // to the auto rule. Tonight is not load-bearing enough to break here.
    return null;
  }
}

export function useTonightExpansion(): [boolean, (open: boolean) => void] {
  const [open, setOpenState] = useState<boolean>(() => {
    const persisted = readPersistedOpen(todayKey());
    return persisted ?? computeDefault();
  });

  // Re-evaluate every minute so 6pm "tips over" without page reload. If
  // the user has explicitly toggled today, leave their choice alone.
  useEffect(() => {
    const id = setInterval(() => {
      const persisted = readPersistedOpen(todayKey());
      if (persisted !== null) return; // user-controlled, skip
      setOpenState(computeDefault());
    }, REEVALUATE_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  const setOpen = (next: boolean) => {
    setOpenState(next);
    const key = todayKey();
    try {
      window.localStorage.setItem(TOUCHED_KEY_PREFIX + key, "true");
      window.localStorage.setItem(STATE_KEY_PREFIX + key, next ? "true" : "false");
    } catch {
      // Best-effort persistence — see readPersistedOpen for the rationale.
    }
  };

  return [open, setOpen];
}
