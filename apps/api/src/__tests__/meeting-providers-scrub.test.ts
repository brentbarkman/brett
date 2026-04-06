import { describe, it, expect } from "vitest";
import { scrubProviderRawData } from "../services/meeting-providers/scrub.js";

describe("scrubProviderRawData", () => {
  describe("granola", () => {
    it("strips attendees, participants, and known_participants", () => {
      const raw = {
        id: "meeting-1",
        title: "Standup",
        attendees: [{ name: "Alice", email: "alice@co.com" }],
        participants: [{ name: "Bob" }],
        known_participants: ["charlie@co.com"],
        otherField: "kept",
      };
      const result = scrubProviderRawData("granola", raw) as Record<string, unknown>;
      expect(result).not.toHaveProperty("attendees");
      expect(result).not.toHaveProperty("participants");
      expect(result).not.toHaveProperty("known_participants");
      expect(result.id).toBe("meeting-1");
      expect(result.otherField).toBe("kept");
      expect(result.attendeeCount).toBe(1);
    });

    it("sets attendeeCount to undefined when attendees is not an array", () => {
      const raw = { id: "meeting-1", attendees: "not-an-array" };
      const result = scrubProviderRawData("granola", raw) as Record<string, unknown>;
      expect(result.attendeeCount).toBeUndefined();
    });
  });

  describe("google_meet", () => {
    it("only keeps transcriptFileId and notesFileId (allowlist)", () => {
      const raw = {
        transcriptFileId: "abc123",
        notesFileId: "def456",
        email: "leaked@co.com",
        suggestionsViewMode: "PREVIEW",
        otherField: "should-be-stripped",
      };
      const result = scrubProviderRawData("google_meet", raw) as Record<string, unknown>;
      expect(result).toEqual({ transcriptFileId: "abc123", notesFileId: "def456" });
    });

    it("returns empty object when no file IDs present", () => {
      const raw = { randomField: "value" };
      const result = scrubProviderRawData("google_meet", raw) as Record<string, unknown>;
      expect(result).toEqual({ transcriptFileId: undefined, notesFileId: undefined });
    });
  });

  describe("unknown provider", () => {
    it("returns raw data unchanged", () => {
      const raw = { foo: "bar" };
      expect(scrubProviderRawData("zoom", raw)).toEqual({ foo: "bar" });
    });
  });

  describe("non-object values", () => {
    it("returns null as-is", () => {
      expect(scrubProviderRawData("granola", null)).toBeNull();
    });

    it("returns string as-is", () => {
      expect(scrubProviderRawData("granola", "hello")).toBe("hello");
    });

    it("returns undefined as-is", () => {
      expect(scrubProviderRawData("granola", undefined)).toBeUndefined();
    });
  });
});
