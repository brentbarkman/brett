import { describe, it, expect } from "vitest";
import { calendarCandidateWindow } from "../granola-sync.js";

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
