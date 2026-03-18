import { describe, it, expect } from "vitest";
import { validateRsvpInput, validateCalendarNoteInput } from "../calendar-validation";

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
