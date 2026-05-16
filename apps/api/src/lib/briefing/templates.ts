import type { TimeOfDay } from "./types.js";

// Empty-state templates fire when the detector returns empty:true (no
// signals worth burning Sonnet tokens on) or when the writer fails.
//
// Load-bearing rule: NEVER interpolate the next-event title here. NextUp
// already renders that title; the brief must not duplicate it. The pools
// below are all title-less by construction.
//
// Each pool has 3 variants keyed by hour-of-day so two adjacent quiet
// days don't render the same line.

const POOLS: Record<TimeOfDay, [string, string, string]> = {
  morning: [
    "Quiet morning — nothing moved overnight.",
    "Calm start. No overnight shifts.",
    "Open morning. Nothing's changed.",
  ],
  midday: [
    "Steady so far. No surprises.",
    "Calm midday — nothing's shifted.",
    "Holding pattern — no changes.",
  ],
  afternoon: [
    "Quiet afternoon ahead.",
    "Nothing new on the board.",
    "Steady afternoon — no shifts.",
  ],
  evening: [
    "Wrapping up — nothing urgent.",
    "Calm evening, nothing pending.",
    "Day's settling — no last-minute moves.",
  ],
};

export function pickEmptyTemplate(timeOfDay: TimeOfDay, hourLocal: number): string {
  const pool = POOLS[timeOfDay];
  return pool[hourLocal % pool.length];
}
