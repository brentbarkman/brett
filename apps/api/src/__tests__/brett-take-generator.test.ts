import { describe, it, expect } from "vitest";
import { qualifiesForTake, needsGeneration, contentHash } from "../services/brett-take-generator.js";

const baseEvent = {
  id: "evt-1",
  title: "Weekly Sync",
  description: null as string | null,
  recurringEventId: null as string | null,
  brettObservation: null as string | null,
  brettObservationAt: null as Date | null,
  brettObservationHash: null as string | null,
  startTime: new Date("2026-04-01T14:00:00Z"),
  location: null as string | null,
  attendeesJson: null as string | null,
};

describe("qualifiesForTake", () => {
  it("rejects event with no description and no recurrence", () => {
    expect(qualifiesForTake(baseEvent, false)).toBe(false);
  });

  it("rejects event with short description (<=50 chars)", () => {
    expect(qualifiesForTake({ ...baseEvent, description: "Join: zoom.us/123" }, false)).toBe(false);
  });

  it("qualifies event with description >50 chars", () => {
    const longDesc = "This is a detailed meeting agenda discussing the quarterly roadmap and resource allocation.";
    expect(qualifiesForTake({ ...baseEvent, description: longDesc }, false)).toBe(true);
  });

  it("qualifies recurring event with prior summary", () => {
    expect(qualifiesForTake({ ...baseEvent, recurringEventId: "rec-123" }, true)).toBe(true);
  });

  it("rejects recurring event without prior summary", () => {
    expect(qualifiesForTake({ ...baseEvent, recurringEventId: "rec-123" }, false)).toBe(false);
  });
});

describe("needsGeneration", () => {
  it("needs generation when brettObservation is null", () => {
    expect(needsGeneration(baseEvent)).toBe(true);
  });

  it("needs generation when brettObservationAt is null", () => {
    expect(needsGeneration({ ...baseEvent, brettObservation: "Some take" })).toBe(true);
  });

  it("needs generation when content hash has changed", () => {
    const hash = contentHash(baseEvent);
    expect(needsGeneration({
      ...baseEvent,
      brettObservation: "Old take",
      brettObservationAt: new Date("2026-04-01T08:00:00Z"),
      brettObservationHash: "different-hash",
    })).toBe(true);
  });

  it("skips generation when content hash matches", () => {
    const hash = contentHash(baseEvent);
    expect(needsGeneration({
      ...baseEvent,
      brettObservation: "Fresh take",
      brettObservationAt: new Date("2026-04-01T12:00:00Z"),
      brettObservationHash: hash,
    })).toBe(false);
  });
});

describe("contentHash", () => {
  it("returns same hash for same content", () => {
    const h1 = contentHash(baseEvent);
    const h2 = contentHash({ ...baseEvent });
    expect(h1).toBe(h2);
  });

  it("returns different hash when description changes", () => {
    const h1 = contentHash(baseEvent);
    const h2 = contentHash({ ...baseEvent, description: "New description that is different" });
    expect(h1).not.toBe(h2);
  });

  it("returns different hash when title changes", () => {
    const h1 = contentHash(baseEvent);
    const h2 = contentHash({ ...baseEvent, title: "Different Meeting" });
    expect(h1).not.toBe(h2);
  });

  it("returns same hash when only irrelevant fields change", () => {
    const h1 = contentHash(baseEvent);
    const h2 = contentHash({ ...baseEvent, id: "evt-2" });
    // id is not in the hash
    expect(h1).toBe(h2);
  });
});
