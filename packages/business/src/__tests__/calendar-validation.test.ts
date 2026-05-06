import { describe, it, expect } from "vitest";
import { validateRsvpInput, validateCalendarNoteInput, isHiddenDeclined } from "../calendar-validation";

describe("validateRsvpInput", () => {
  it("accepts valid RSVP with status only", () => {
    const result = validateRsvpInput({ status: "accepted" });
    expect(result.ok).toBe(true);
  });

  it("accepts valid RSVP with comment", () => {
    const result = validateRsvpInput({ status: "tentative", comment: "Running late" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.comment).toBe("Running late");
  });

  it("rejects invalid status", () => {
    const result = validateRsvpInput({ status: "maybe" as any });
    expect(result.ok).toBe(false);
  });

  it("rejects missing status", () => {
    const result = validateRsvpInput({} as any);
    expect(result.ok).toBe(false);
  });

  it("rejects comment over 500 chars", () => {
    const result = validateRsvpInput({ status: "accepted", comment: "x".repeat(501) });
    expect(result.ok).toBe(false);
  });
});

describe("validateCalendarNoteInput", () => {
  it("accepts valid note", () => {
    const result = validateCalendarNoteInput({ content: "My notes" });
    expect(result.ok).toBe(true);
  });

  it("rejects empty content", () => {
    const result = validateCalendarNoteInput({ content: "" });
    expect(result.ok).toBe(false);
  });

  it("rejects content over 50KB", () => {
    const result = validateCalendarNoteInput({ content: "x".repeat(50 * 1024 + 1) });
    expect(result.ok).toBe(false);
  });
});

describe("isHiddenDeclined", () => {
  // Pins the timeline-visibility rule shared by every list/timeline
  // surface (desktop sidebar, today, main calendar; iOS Today, Calendar,
  // Next Up). The rule mirrors Google Calendar: declined events are
  // hidden EXCEPT when the user organized them — declining your own
  // event is unusual and the user almost always still wants to see it.
  it("hides events the user declined and someone else organized", () => {
    expect(
      isHiddenDeclined({
        myResponseStatus: "declined",
        organizer: { name: "Alice", email: "alice@example.com", self: false },
      }),
    ).toBe(true);
  });

  it("keeps declined events the user organized visible", () => {
    // The bug this guards against: events you created (e.g. a solo
    // focus block you later said 'no' to) silently disappearing from
    // your own calendar.
    expect(
      isHiddenDeclined({
        myResponseStatus: "declined",
        organizer: { name: "You", email: "you@example.com", self: true },
      }),
    ).toBe(false);
  });

  it("treats declined-with-no-organizer-info as hidden (defensive)", () => {
    // If we have no organizer info we can't prove ownership — fall back
    // to the declined-hide default rather than silently leaking.
    expect(
      isHiddenDeclined({
        myResponseStatus: "declined",
        organizer: null,
      }),
    ).toBe(true);
  });

  it("keeps non-declined events visible regardless of organizer", () => {
    for (const status of ["accepted", "tentative", "needsAction"] as const) {
      expect(
        isHiddenDeclined({
          myResponseStatus: status,
          organizer: { name: "Alice", email: "alice@example.com", self: false },
        }),
      ).toBe(false);
      expect(
        isHiddenDeclined({
          myResponseStatus: status,
          organizer: { name: "You", email: "you@example.com", self: true },
        }),
      ).toBe(false);
    }
  });

  it("treats organizer.self omitted as not-organizer (matches Google API absent-default)", () => {
    // Google's Calendar API only sets `self: true` when the organizer
    // matches the calendar this copy of the event lives on. Missing /
    // undefined `self` means "not me" — treat as such, otherwise we'd
    // un-hide every declined event from a shared calendar where the
    // organizer info merely doesn't bother to spell out `self: false`.
    expect(
      isHiddenDeclined({
        myResponseStatus: "declined",
        organizer: { name: "Someone", email: "someone@example.com" },
      }),
    ).toBe(true);
  });
});
