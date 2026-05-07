import { useState, useEffect } from "react";
import type { CalendarEventDisplay } from "@brett/types";
import { useVisibilityAwareInterval } from "./useNow";

export interface NextUpTimerState {
  label: string;
  minutesAway: number;
  isUrgent: boolean;
  isHappening: boolean;
  isExpired: boolean;
  minutesRemaining: number;
}

export interface NextUpResult {
  event: CalendarEventDisplay | null;
  timer: NextUpTimerState | null;
}

/** Parse time string to minutes-since-midnight. Handles both "HH:MM" and ISO date strings. */
export function parseTimeToMinutes(timeStr: string): number {
  if (timeStr.includes("T") || timeStr.includes("-")) {
    const d = new Date(timeStr);
    return d.getHours() * 60 + d.getMinutes();
  }
  const [h, m] = timeStr.split(":").map(Number);
  return h * 60 + m;
}

/**
 * Resolve a time string to an absolute epoch ms relative to a reference Date.
 * ISO strings keep their own date; bare HH:MM is interpreted as that time on
 * the reference date's local day. Used by selection so a stale events list
 * (e.g. yesterday's calendar slipped through) cannot pick a previous-day
 * event whose end-of-day HH:MM happens to be later than the current HH:MM.
 */
function parseTimeToMs(timeStr: string, ref: Date): number {
  if (timeStr.includes("T") || timeStr.includes("-")) {
    return new Date(timeStr).getTime();
  }
  const [h, m] = timeStr.split(":").map(Number);
  const d = new Date(ref);
  d.setHours(h, m, 0, 0);
  return d.getTime();
}

function getNowMinutes(): number {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

function formatCountdown(minutesAway: number): string {
  if (minutesAway <= 0) return "Now";
  if (minutesAway < 60) return `in ${minutesAway} min`;
  const hours = Math.floor(minutesAway / 60);
  const mins = minutesAway % 60;
  if (mins === 0) return `in ${hours}h`;
  const roundedMins = Math.round(mins / 5) * 5;
  if (roundedMins === 0) return `in ${hours}h`;
  if (roundedMins === 60) return `in ${hours + 1}h`;
  return `in ${hours}h ${roundedMins}m`;
}

function selectNextUpEvent(
  events: CalendarEventDisplay[],
  ref: Date,
): CalendarEventDisplay | null {
  if (!events.length) return null;
  const nowMs = ref.getTime();
  return events.find((e) => parseTimeToMs(e.endTime, ref) > nowMs) ?? null;
}

function computeNextUpState(
  event: CalendarEventDisplay | null,
  now: number,
): NextUpTimerState | null {
  if (!event) return null;

  const startMin = parseTimeToMinutes(event.startTime);
  const endMin = parseTimeToMinutes(event.endTime);
  const minutesAway = startMin - now;
  const minutesRemaining = endMin - now;
  const isHappening = minutesAway <= 0 && minutesRemaining > 0;
  const isExpired = minutesRemaining <= 0;

  let label: string;
  if (isExpired) {
    label = "Ended";
  } else if (isHappening) {
    label = `${minutesRemaining} min left`;
  } else {
    label = formatCountdown(minutesAway);
  }

  return {
    label,
    minutesAway,
    isUrgent: minutesAway <= 10 && minutesAway > 0,
    isHappening,
    isExpired,
    minutesRemaining: Math.max(0, minutesRemaining),
  };
}

function statesEqual(
  a: NextUpTimerState | null,
  b: NextUpTimerState | null,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.label === b.label &&
    a.minutesAway === b.minutesAway &&
    a.isUrgent === b.isUrgent &&
    a.isHappening === b.isHappening &&
    a.isExpired === b.isExpired &&
    a.minutesRemaining === b.minutesRemaining
  );
}

function resultsEqual(a: NextUpResult, b: NextUpResult): boolean {
  return a.event === b.event && statesEqual(a.timer, b.timer);
}

function compute(
  events: CalendarEventDisplay[],
  nowOverride?: string,
): NextUpResult {
  // ref is a real Date so selection can compare full timestamps. nowOverride
  // (HH:MM or ISO) is interpreted as that moment on today's local day, which
  // matches the previous semantics for callers that supply a HH:MM string.
  const ref = nowOverride ? buildRefFromOverride(nowOverride) : new Date();
  const nowMin = nowOverride ? parseTimeToMinutes(nowOverride) : getNowMinutes();
  const event = selectNextUpEvent(events, ref);
  return { event, timer: computeNextUpState(event, nowMin) };
}

function buildRefFromOverride(s: string): Date {
  if (s.includes("T") || s.includes("-")) return new Date(s);
  const [h, m] = s.split(":").map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d;
}

/**
 * Returns the current "Up Next" event from the supplied list AND its
 * timer state. The hook owns selection so that when the active event's
 * end time passes, the next visibility-aware tick advances to the next
 * event without needing a parent re-render.
 *
 * History: previously the caller did the selection in render and passed
 * a single event in. The timer hook then re-rendered every 10s but only
 * the card subtree saw it — the parent's selection stayed frozen until
 * something else re-rendered, so the card showed "Ended" forever after
 * the meeting passed.
 */
export function useNextUpTimer(
  events: CalendarEventDisplay[],
  nowOverride?: string,
): NextUpResult {
  const [result, setResult] = useState<NextUpResult>(() =>
    compute(events, nowOverride),
  );

  // Recompute when the input list changes (e.g. calendar sync brings new
  // data) or when nowOverride flips.
  useEffect(() => {
    const next = compute(events, nowOverride);
    setResult((prev) => (resultsEqual(prev, next) ? prev : next));
  }, [events, nowOverride]);

  // Visibility-gated periodic tick — pauses while the window is hidden
  // so we don't wake the renderer every 10s for a card the user can't
  // see. Each tick re-runs selection AND state computation against the
  // current clock.
  useVisibilityAwareInterval(() => {
    const next = compute(events, nowOverride);
    setResult((prev) => (resultsEqual(prev, next) ? prev : next));
  }, 10_000);

  return result;
}
