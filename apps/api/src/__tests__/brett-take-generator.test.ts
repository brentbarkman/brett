import { describe, it, expect } from "vitest";
import { qualifiesForTake, needsGeneration } from "../services/brett-take-generator.js";

describe("qualifiesForTake", () => {
  const base = {
    id: "evt-1",
    description: null as string | null,
    recurringEventId: null as string | null,
    brettObservation: null as string | null,
    brettObservationAt: null as Date | null,
    updatedAt: new Date("2026-04-01T10:00:00Z"),
  };

  it("rejects event with no description and no recurrence", () => {
    expect(qualifiesForTake(base, false)).toBe(false);
  });

  it("rejects event with short description (<=50 chars)", () => {
    expect(qualifiesForTake({ ...base, description: "Join: zoom.us/123" }, false)).toBe(false);
  });

  it("qualifies event with description >50 chars", () => {
    const longDesc = "This is a detailed meeting agenda discussing the quarterly roadmap and resource allocation.";
    expect(qualifiesForTake({ ...base, description: longDesc }, false)).toBe(true);
  });

  it("qualifies recurring event with prior transcript", () => {
    expect(qualifiesForTake({ ...base, recurringEventId: "rec-123" }, true)).toBe(true);
  });

  it("rejects recurring event without prior transcript", () => {
    expect(qualifiesForTake({ ...base, recurringEventId: "rec-123" }, false)).toBe(false);
  });
});

describe("needsGeneration", () => {
  const base = {
    id: "evt-1",
    description: "A long enough description for a meeting about quarterly planning and resource allocation.",
    recurringEventId: null as string | null,
    brettObservation: null as string | null,
    brettObservationAt: null as Date | null,
    updatedAt: new Date("2026-04-01T10:00:00Z"),
  };

  it("needs generation when brettObservation is null", () => {
    expect(needsGeneration(base)).toBe(true);
  });

  it("needs generation when brettObservationAt is null", () => {
    expect(needsGeneration({ ...base, brettObservation: "Some take" })).toBe(true);
  });

  it("needs generation when observation is stale", () => {
    expect(needsGeneration({
      ...base,
      brettObservation: "Old take",
      brettObservationAt: new Date("2026-04-01T08:00:00Z"),
    })).toBe(true);
  });

  it("skips generation when observation is fresh", () => {
    expect(needsGeneration({
      ...base,
      brettObservation: "Fresh take",
      brettObservationAt: new Date("2026-04-01T12:00:00Z"),
    })).toBe(false);
  });
});
