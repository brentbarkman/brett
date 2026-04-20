import { describe, it, expect } from "vitest";
import {
  calendarCandidateWindow,
  resolveMeetingTimes,
} from "../granola-sync.js";

// Granola's meeting list API returns start/end times that do not reliably
// line up with the corresponding Google Calendar event times. Observed offsets
// in production: 4 hours and 7 hours vs the real calendar startTime, with
// `end_time === start_time` for every row. The candidate-fetch window used by
// syncMeetings must therefore be padded generously so the real calendar event
// still falls inside it — otherwise the title-match never gets a chance.

describe("calendarCandidateWindow", () => {
  it("pads the window wide enough to include a same-day calendar event offset by 7h", () => {
    // Reproduces the bug where a Granola meeting stored as 10:00 UTC on
    // 2026-04-17 was actually the 17:00-17:30 UTC calendar event on the
    // same day. The previous window (earliest-1h .. latest+1h, with
    // end_time=start_time from Granola) clamped the upper bound to 11:00 UTC
    // and excluded the real event.
    const { gte, lte } = calendarCandidateWindow([
      { start_time: "2026-04-17T10:00:00Z" },
    ]);

    const calEventStart = new Date("2026-04-17T17:00:00Z");
    const calEventEnd = new Date("2026-04-17T17:30:00Z");

    expect(calEventStart.getTime()).toBeGreaterThanOrEqual(gte.getTime());
    expect(calEventStart.getTime()).toBeLessThanOrEqual(lte.getTime());
    expect(calEventEnd.getTime()).toBeLessThanOrEqual(lte.getTime());
  });

  it("bounds use start_time only — never collapses even when end_time === start_time", () => {
    // Granola returns zero-width intervals (end_time === start_time) for
    // every row. The window must not depend on end_time.
    const window = calendarCandidateWindow([
      { start_time: "2026-04-14T15:00:00Z" },
      { start_time: "2026-04-17T10:00:00Z" },
    ]);

    expect(window.lte.getTime()).toBeGreaterThan(
      new Date("2026-04-17T10:00:00Z").getTime(),
    );
    expect(window.gte.getTime()).toBeLessThan(
      new Date("2026-04-14T15:00:00Z").getTime(),
    );
  });

  it("spans from the earliest to the latest meeting across a multi-day batch", () => {
    const { gte, lte } = calendarCandidateWindow([
      { start_time: "2026-03-23T11:00:00Z" },
      { start_time: "2026-03-27T14:00:00Z" },
      { start_time: "2026-04-17T10:00:00Z" },
    ]);

    // Earliest meeting
    expect(new Date("2026-03-23T11:00:00Z").getTime()).toBeGreaterThanOrEqual(
      gte.getTime(),
    );
    // Latest meeting + a full day to absorb timezone drift
    const latestCalPossible = new Date("2026-04-17T23:59:59Z");
    expect(latestCalPossible.getTime()).toBeLessThanOrEqual(lte.getTime());
  });

  it("handles a single meeting", () => {
    const { gte, lte } = calendarCandidateWindow([
      { start_time: "2026-04-17T10:00:00Z" },
    ]);
    expect(lte.getTime()).toBeGreaterThan(gte.getTime());
  });
});

// Granola's list_meetings / get_meetings payload carries a single
// human-readable `date` string — no end time, no duration, no timezone
// indicator (confirmed via direct MCP probe, e.g. `date="Apr 17, 2026
// 10:00 AM"`). Our ingest layer parses that with `new Date()` which
// interprets it as server-local (UTC on Railway), producing times that
// drift 4-7h from the real Google Calendar event depending on the
// meeting's original organizer timezone. Separately, we synthesize
// `end_time` = `start_time`, yielding zero-width intervals.
//
// Fix: when a calendar event matched, trust its startTime/endTime.
// When nothing matched, keep Granola's start as a sort-key fallback
// and default end = start + 30min so durations aren't zero.

describe("resolveMeetingTimes", () => {
  const granolaStart = new Date("2026-04-17T10:00:00Z");

  it("uses the linked calendar event's times when matched", () => {
    const matched = {
      startTime: new Date("2026-04-17T17:00:00Z"),
      endTime: new Date("2026-04-17T17:30:00Z"),
    };
    const result = resolveMeetingTimes(granolaStart, matched);
    expect(result.startedAt).toEqual(matched.startTime);
    expect(result.endedAt).toEqual(matched.endTime);
  });

  it("falls back to Granola start + 30min when nothing matched", () => {
    const result = resolveMeetingTimes(granolaStart, null);
    expect(result.startedAt).toEqual(granolaStart);
    expect(result.endedAt.getTime() - result.startedAt.getTime()).toBe(
      30 * 60 * 1000,
    );
  });

  it("never returns a zero-width interval even if Granola provides one", () => {
    const result = resolveMeetingTimes(granolaStart, null);
    expect(result.endedAt.getTime()).toBeGreaterThan(result.startedAt.getTime());
  });
});
