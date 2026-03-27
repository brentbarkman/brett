import { describe, it, expect } from "vitest";
import { getUserDayBounds } from "../index";

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
