import { describe, it, expect } from "vitest";
import {
  getUserDayBounds,
  computeTriageResult,
  computeUrgency,
  type TriageDatePreset,
} from "../index";
import type { Urgency } from "@brett/types";

describe("getUserDayBounds", () => {
  // Fixed reference time: 2026-03-26T15:00:00Z (Thursday 3pm UTC)
  const NOW = new Date("2026-03-26T15:00:00Z");

  it("returns correct bounds for UTC", () => {
    const { startOfDay, endOfDay } = getUserDayBounds("UTC", NOW);
    expect(startOfDay.toISOString()).toBe("2026-03-26T00:00:00.000Z");
    expect(endOfDay.toISOString()).toBe("2026-03-27T00:00:00.000Z");
  });

  it("returns correct bounds for America/New_York (UTC-4 in March DST)", () => {
    const { startOfDay, endOfDay } = getUserDayBounds("America/New_York", NOW);
    expect(startOfDay.toISOString()).toBe("2026-03-26T04:00:00.000Z");
    expect(endOfDay.toISOString()).toBe("2026-03-27T04:00:00.000Z");
  });

  it("returns correct bounds for Asia/Tokyo (UTC+9, no DST)", () => {
    const { startOfDay, endOfDay } = getUserDayBounds("Asia/Tokyo", NOW);
    expect(startOfDay.toISOString()).toBe("2026-03-26T15:00:00.000Z");
    expect(endOfDay.toISOString()).toBe("2026-03-27T15:00:00.000Z");
  });

  it("returns correct bounds for Pacific/Auckland (UTC+13 in March NZDT)", () => {
    const { startOfDay, endOfDay } = getUserDayBounds("Pacific/Auckland", NOW);
    expect(startOfDay.toISOString()).toBe("2026-03-26T11:00:00.000Z");
    expect(endOfDay.toISOString()).toBe("2026-03-27T11:00:00.000Z");
  });

  it("handles DST spring-forward (US clocks skip 2am → 3am on March 8 2026)", () => {
    const springForward = new Date("2026-03-08T12:00:00Z");
    const { startOfDay, endOfDay } = getUserDayBounds("America/New_York", springForward);
    expect(startOfDay.toISOString()).toBe("2026-03-08T05:00:00.000Z");
    expect(endOfDay.toISOString()).toBe("2026-03-09T04:00:00.000Z");
  });

  it("handles DST fall-back (US clocks repeat 2am → 1am on Nov 1 2026)", () => {
    const fallBack = new Date("2026-11-01T12:00:00Z");
    const { startOfDay, endOfDay } = getUserDayBounds("America/New_York", fallBack);
    expect(startOfDay.toISOString()).toBe("2026-11-01T04:00:00.000Z");
    expect(endOfDay.toISOString()).toBe("2026-11-02T05:00:00.000Z");
  });

  it("handles UTC+14 (Pacific/Kiritimati)", () => {
    const { startOfDay, endOfDay } = getUserDayBounds("Pacific/Kiritimati", NOW);
    expect(startOfDay.toISOString()).toBe("2026-03-26T10:00:00.000Z");
    expect(endOfDay.toISOString()).toBe("2026-03-27T10:00:00.000Z");
  });

  it("defaults to current time when now is omitted", () => {
    const { startOfDay, endOfDay } = getUserDayBounds("UTC");
    expect(startOfDay).toBeInstanceOf(Date);
    expect(endOfDay).toBeInstanceOf(Date);
    // UTC has no DST, so this is always exactly 24h
    expect(endOfDay.getTime() - startOfDay.getTime()).toBe(86400000);
  });
});

// ── Friday-evening Mountain Time scenario ──
// Reproduces the user-reported bug: at Friday 21:43 MDT (= Saturday 03:43 UTC),
// picking "this weekend" should resolve to Saturday (the user's tomorrow), and
// any item due Saturday should bucket as `this_weekend`, NOT `today`.

describe("Friday-evening Mountain Time (the user-reported bug)", () => {
  // 2026-05-15 21:43 MDT = 2026-05-16 03:43 UTC.
  // UTC date is already Saturday; user's local date is still Friday.
  const NOW = new Date("2026-05-16T03:43:00Z");
  const TZ = "America/Denver";

  describe("computeTriageResult uses user-local 'today'", () => {
    it("'today' → user's local Friday May 15, NOT UTC's Saturday May 16", () => {
      const r = computeTriageResult("today", NOW, TZ);
      expect(r.dueDate).toBe("2026-05-15T00:00:00.000Z");
      expect(r.dueDatePrecision).toBe("day");
    });

    it("'tomorrow' → Saturday May 16", () => {
      const r = computeTriageResult("tomorrow", NOW, TZ);
      expect(r.dueDate).toBe("2026-05-16T00:00:00.000Z");
    });

    it("'this_weekend' → upcoming Saturday May 16 (not collapsing to 'today')", () => {
      const r = computeTriageResult("this_weekend", NOW, TZ);
      expect(r.dueDate).toBe("2026-05-16T00:00:00.000Z");
    });

    it("'this_week' → today (Friday May 15, day-precision)", () => {
      const r = computeTriageResult("this_week", NOW, TZ);
      expect(r.dueDate).toBe("2026-05-15T00:00:00.000Z");
      expect(r.dueDatePrecision).toBe("day");
    });

    it("'next_week' → next Friday May 22", () => {
      const r = computeTriageResult("next_week", NOW, TZ);
      expect(r.dueDate).toBe("2026-05-22T00:00:00.000Z");
      expect(r.dueDatePrecision).toBe("day");
    });

    it("'next_month' → June 1", () => {
      const r = computeTriageResult("next_month", NOW, TZ);
      expect(r.dueDate).toBe("2026-06-01T00:00:00.000Z");
    });
  });

  describe("computeUrgency uses user-local 'today'", () => {
    it("dueDate Saturday May 16 bucketed as 'this_weekend' (not 'today')", () => {
      const sat = new Date("2026-05-16T00:00:00Z");
      expect(computeUrgency(sat, null, NOW, TZ)).toBe("this_weekend");
    });

    it("dueDate Friday May 15 bucketed as 'today' (user's local day)", () => {
      const fri = new Date("2026-05-15T00:00:00Z");
      expect(computeUrgency(fri, null, NOW, TZ)).toBe("today");
    });

    it("dueDate Monday May 18 bucketed as 'next_week'", () => {
      const mon = new Date("2026-05-18T00:00:00Z");
      expect(computeUrgency(mon, null, NOW, TZ)).toBe("next_week");
    });
  });

  describe("triage → urgency round-trip stays in the intended bucket", () => {
    function rt(preset: TriageDatePreset): Urgency {
      const r = computeTriageResult(preset, NOW, TZ);
      return computeUrgency(new Date(r.dueDate), null, NOW, TZ);
    }

    it("today → 'today'", () => expect(rt("today")).toBe("today"));
    it("tomorrow → 'this_weekend' (Friday's tomorrow is Saturday)", () =>
      expect(rt("tomorrow")).toBe("this_weekend"));
    it("this_weekend → 'this_weekend' (the critical regression)", () =>
      expect(rt("this_weekend")).toBe("this_weekend"));
    // On Friday, this_week stores today (Fri) → bucket collapses with `today`.
    it("this_week on Friday → 'today'", () => expect(rt("this_week")).toBe("today"));
    it("next_week → 'next_week'", () => expect(rt("next_week")).toBe("next_week"));
    it("next_month → 'later'", () => expect(rt("next_month")).toBe("later"));
  });

  it("Today/Tomorrow/This Weekend produce three distinct stored dates", () => {
    // The visible "missing option" bug: chips collapse onto the same date
    // because all three resolve through UTC. Confirm they're distinct now.
    const t = computeTriageResult("today", NOW, TZ).dueDate;
    const tm = computeTriageResult("tomorrow", NOW, TZ).dueDate;
    const tw = computeTriageResult("this_weekend", NOW, TZ).dueDate;
    expect(t).not.toBe(tm);
    // Friday → tomorrow IS the weekend, so tomorrow == this_weekend by design.
    expect(tm).toBe(tw);
    expect(t).not.toBe(tw);
  });
});

// ── East-of-UTC scenario (Tokyo crossing midnight before UTC) ──

describe("Sunday-evening Tokyo (Tokyo crosses midnight before UTC)", () => {
  // 2026-05-18 01:00 JST = 2026-05-17 16:00 UTC. Tokyo: Mon. UTC: Sun.
  const NOW = new Date("2026-05-17T16:00:00Z");
  const TZ = "Asia/Tokyo";

  it("'today' → Monday May 18 in Tokyo, NOT Sunday May 17 in UTC", () => {
    expect(computeTriageResult("today", NOW, TZ).dueDate).toBe("2026-05-18T00:00:00.000Z");
  });

  it("'this_weekend' → upcoming Saturday May 23 (Mon → next Sat)", () => {
    expect(computeTriageResult("this_weekend", NOW, TZ).dueDate).toBe(
      "2026-05-23T00:00:00.000Z",
    );
  });

  it("dueDate Monday May 18 bucketed as 'today' in Tokyo", () => {
    const mon = new Date("2026-05-18T00:00:00Z");
    expect(computeUrgency(mon, null, NOW, TZ)).toBe("today");
  });
});

// ── Cross-platform parity fixture ──
// The iOS Swift suite asserts identical outputs for the same fixtures —
// see apps/ios/BrettTests/Views/CrossPlatformTriageFixtureTests.swift.

describe("cross-platform parity fixture", () => {
  type Row = {
    now: string;
    tz: string;
    preset: TriageDatePreset;
    expected: string;
  };

  const FIXTURES: Row[] = [
    // Friday 21:43 MDT — local Fri, UTC Sat.
    { now: "2026-05-16T03:43:00Z", tz: "America/Denver", preset: "today",        expected: "2026-05-15T00:00:00.000Z" },
    { now: "2026-05-16T03:43:00Z", tz: "America/Denver", preset: "tomorrow",     expected: "2026-05-16T00:00:00.000Z" },
    { now: "2026-05-16T03:43:00Z", tz: "America/Denver", preset: "this_weekend", expected: "2026-05-16T00:00:00.000Z" },
    // Friday → this_week stores today (Fri); next_week stores next Friday (+7).
    { now: "2026-05-16T03:43:00Z", tz: "America/Denver", preset: "this_week",    expected: "2026-05-15T00:00:00.000Z" },
    { now: "2026-05-16T03:43:00Z", tz: "America/Denver", preset: "next_week",    expected: "2026-05-22T00:00:00.000Z" },
    { now: "2026-05-16T03:43:00Z", tz: "America/Denver", preset: "next_month",   expected: "2026-06-01T00:00:00.000Z" },

    // Tuesday 14:30 PDT.
    { now: "2026-05-19T21:30:00Z", tz: "America/Los_Angeles", preset: "today",       expected: "2026-05-19T00:00:00.000Z" },
    { now: "2026-05-19T21:30:00Z", tz: "America/Los_Angeles", preset: "this_weekend", expected: "2026-05-23T00:00:00.000Z" },
    // Tue → this_week stores this Fri (+3 = May 22); next_week stores +10 = May 29.
    { now: "2026-05-19T21:30:00Z", tz: "America/Los_Angeles", preset: "this_week",   expected: "2026-05-22T00:00:00.000Z" },
    { now: "2026-05-19T21:30:00Z", tz: "America/Los_Angeles", preset: "next_week",   expected: "2026-05-29T00:00:00.000Z" },

    // Mon 01:00 JST (= Sun 16:00 UTC).
    { now: "2026-05-17T16:00:00Z", tz: "Asia/Tokyo", preset: "today",       expected: "2026-05-18T00:00:00.000Z" },
    { now: "2026-05-17T16:00:00Z", tz: "Asia/Tokyo", preset: "this_weekend", expected: "2026-05-23T00:00:00.000Z" },
    // Mon → this Fri is +4 days = May 22; next Fri is +11 = May 29.
    { now: "2026-05-17T16:00:00Z", tz: "Asia/Tokyo", preset: "this_week",   expected: "2026-05-22T00:00:00.000Z" },
    { now: "2026-05-17T16:00:00Z", tz: "Asia/Tokyo", preset: "next_week",   expected: "2026-05-29T00:00:00.000Z" },

    // UTC midday baseline — Friday Mar 13.
    { now: "2026-03-13T12:00:00Z", tz: "UTC", preset: "today",        expected: "2026-03-13T00:00:00.000Z" },
    { now: "2026-03-13T12:00:00Z", tz: "UTC", preset: "this_weekend", expected: "2026-03-14T00:00:00.000Z" },
    { now: "2026-03-13T12:00:00Z", tz: "UTC", preset: "this_week",    expected: "2026-03-13T00:00:00.000Z" },
    { now: "2026-03-13T12:00:00Z", tz: "UTC", preset: "next_week",    expected: "2026-03-20T00:00:00.000Z" },
  ];

  for (const { now, tz, preset, expected } of FIXTURES) {
    it(`${preset} @ ${now} in ${tz} → ${expected}`, () => {
      const r = computeTriageResult(preset, new Date(now), tz);
      expect(r.dueDate).toBe(expected);
    });
  }
});

// `normalizeDueDate` was removed alongside the
// `20260515230000_normalize_due_date_to_utc_midnight_and_friday` migration —
// the migration snaps every stored dueDate to UTC midnight of the user's
// calendar date so there's no legacy shape to defensively re-anchor on read.
