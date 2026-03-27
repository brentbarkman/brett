import { useState, useEffect, useCallback } from "react";
import type { CalendarEventDisplay } from "@brett/types";

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

export function useNextUpTimer(
  event: CalendarEventDisplay | null,
  nowOverride?: string
): NextUpTimerState | null {
  const computeState = useCallback((): NextUpTimerState | null => {
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
  }, [event, nowOverride]);

  const [state, setState] = useState<NextUpTimerState | null>(computeState);

  useEffect(() => {
    setState(computeState());
    if (nowOverride) return;
    const intervalMs = state?.isUrgent || state?.isHappening ? 10_000 : 30_000;
    const id = setInterval(() => setState(computeState()), intervalMs);
    return () => clearInterval(id);
  }, [computeState, nowOverride, state?.isUrgent, state?.isHappening]);

  return state;
}
