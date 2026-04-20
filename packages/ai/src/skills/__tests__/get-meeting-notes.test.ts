import { describe, it, expect } from "vitest";
import { titleMatchesCalendarEvent } from "../get-meeting-notes.js";

// Title-match helper for the get_meeting_notes fallback path. When a
// calendarEventId lookup returns null (matcher didn't link the meeting
// to its calendar event), we look for an unlinked MeetingNote on the
// same day whose title matches either direction of containment.

describe("titleMatchesCalendarEvent", () => {
  it("matches exact titles", () => {
    expect(
      titleMatchesCalendarEvent(
        "Brent Barkman and Yves Beauzil",
        "Brent Barkman and Yves Beauzil",
      ),
    ).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(
      titleMatchesCalendarEvent(
        "brent barkman and yves beauzil",
        "BRENT BARKMAN AND YVES BEAUZIL",
      ),
    ).toBe(true);
  });

  it("matches when Granola's title is a prefix/subset of the calendar title", () => {
    // Observed in prod: calendar titles often carry brackets/tags that
    // Granola strips (e.g. "[VC] " prefix on VC intro calls).
    expect(
      titleMatchesCalendarEvent(
        "Intros: Brent x Swetha",
        "[VC] Intros: Brent x Swetha",
      ),
    ).toBe(true);
  });

  it("matches when the calendar title is a subset of Granola's title", () => {
    expect(
      titleMatchesCalendarEvent(
        "Weekly Sync — Brent and Dan",
        "Weekly Sync",
      ),
    ).toBe(true);
  });

  it("rejects unrelated titles", () => {
    expect(
      titleMatchesCalendarEvent(
        "Brent Barkman and Yves Beauzil",
        "Q3 Planning Review",
      ),
    ).toBe(false);
  });

  it("rejects empty titles", () => {
    expect(titleMatchesCalendarEvent("", "anything")).toBe(false);
    expect(titleMatchesCalendarEvent("anything", "")).toBe(false);
    expect(titleMatchesCalendarEvent("  ", "anything")).toBe(false);
  });
});
