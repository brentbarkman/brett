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

/** Parse time string to minutes-since-midnight. Handles both "HH:MM" and ISO date strings. */
export function parseTimeToMinutes(timeStr: string): number {
  if (timeStr.includes("T") || timeStr.includes("-")) {
    const d = new Date(timeStr);
    return d.getHours() * 60 + d.getMinutes();
  }
  const [h, m] = timeStr.split(":").map(Number);
  return h * 60 + m;
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

function computeNextUpState(
  event: CalendarEventDisplay | null,
  nowOverride?: string,
): NextUpTimerState | null {
  if (!event) return null;

  const now = nowOverride ? parseTimeToMinutes(nowOverride) : getNowMinutes();
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

export function useNextUpTimer(
  event: CalendarEventDisplay | null,
  nowOverride?: string,
): NextUpTimerState | null {
  const [state, setState] = useState<NextUpTimerState | null>(() =>
    computeNextUpState(event, nowOverride),
  );

  // Recompute on event/nowOverride change. statesEqual prevents a render
  // when the new value matches what we already have (e.g. event identity
  // changed but its fields didn't).
  useEffect(() => {
    const next = computeNextUpState(event, nowOverride);
    setState((prev) => (statesEqual(prev, next) ? prev : next));
  }, [event?.id, event?.startTime, event?.endTime, nowOverride]);

  // Visibility-gated periodic tick — pauses while the window is hidden so
  // we don't wake the renderer every 10s for a card the user can't see.
  useVisibilityAwareInterval(() => {
    const next = computeNextUpState(event, nowOverride);
    setState((prev) => (statesEqual(prev, next) ? prev : next));
  }, 10_000);

  return state;
}
