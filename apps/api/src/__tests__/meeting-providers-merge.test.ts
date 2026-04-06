import { describe, it, expect } from "vitest";
import { mergeMeetingNoteFields, type MergeInput } from "../services/meeting-providers/merge.js";

const granolaSummary = "Discussed Q3 roadmap priorities and assigned owners.";
const googleSummary = "Meeting notes from Google Meet";

const granolaTranscript = [
  { source: "microphone" as const, speaker: "Alice", text: "Let's discuss the roadmap." },
  { source: "speaker" as const, speaker: "Bob", text: "I'll take the API work." },
];

const googleTranscript = [
  { source: "speaker" as const, speaker: "Alice", text: "Let's discuss the roadmap." },
];

describe("mergeMeetingNoteFields", () => {
  it("uses first source when no existing data", () => {
    const result = mergeMeetingNoteFields(
      { title: null, summary: null, transcript: null, attendees: null, sources: [] },
      { provider: "granola", title: "Roadmap Review", summary: granolaSummary, transcript: granolaTranscript, attendees: [{ name: "Alice", email: "alice@co.com" }] },
    );
    expect(result.title).toBe("Roadmap Review");
    expect(result.summary).toBe(granolaSummary);
    expect(result.transcript).toEqual(granolaTranscript);
    expect(result.sources).toEqual(["granola"]);
  });

  it("keeps existing title when merging second source", () => {
    const result = mergeMeetingNoteFields(
      { title: "Roadmap Review", summary: granolaSummary, transcript: granolaTranscript, attendees: [{ name: "Alice", email: "alice@co.com" }], sources: ["granola"] },
      { provider: "google_meet", title: "Roadmap Review 2", summary: googleSummary, transcript: googleTranscript, attendees: [{ name: "Bob", email: "bob@co.com" }] },
    );
    expect(result.title).toBe("Roadmap Review");
    expect(result.sources).toEqual(["granola", "google_meet"]);
  });

  it("prefers granola summary over google_meet", () => {
    const result = mergeMeetingNoteFields(
      { title: "Meeting", summary: null, transcript: null, attendees: null, sources: [] },
      { provider: "google_meet", title: "Meeting", summary: googleSummary, transcript: null, attendees: null },
    );
    expect(result.summary).toBe(googleSummary);

    const result2 = mergeMeetingNoteFields(
      { title: "Meeting", summary: googleSummary, transcript: null, attendees: null, sources: ["google_meet"] },
      { provider: "granola", title: "Meeting", summary: granolaSummary, transcript: null, attendees: null },
    );
    expect(result2.summary).toBe(granolaSummary);
  });

  it("prefers longer transcript", () => {
    const result = mergeMeetingNoteFields(
      { title: "Meeting", summary: null, transcript: googleTranscript, attendees: null, sources: ["google_meet"] },
      { provider: "granola", title: "Meeting", summary: null, transcript: granolaTranscript, attendees: null },
    );
    expect(result.transcript).toEqual(granolaTranscript);
  });

  it("unions attendees by email (case-insensitive)", () => {
    const result = mergeMeetingNoteFields(
      { title: "Meeting", summary: null, transcript: null, attendees: [{ name: "Alice", email: "alice@co.com" }], sources: ["granola"] },
      { provider: "google_meet", title: "Meeting", summary: null, transcript: null, attendees: [{ name: "Alice A", email: "Alice@co.com" }, { name: "Bob", email: "bob@co.com" }] },
    );
    expect(result.attendees).toHaveLength(2);
    expect(result.attendees!.map((a) => a.email)).toContain("alice@co.com");
    expect(result.attendees!.map((a) => a.email)).toContain("bob@co.com");
  });

  it("does not duplicate provider in sources", () => {
    const result = mergeMeetingNoteFields(
      { title: "Meeting", summary: null, transcript: null, attendees: null, sources: ["granola"] },
      { provider: "granola", title: "Meeting", summary: null, transcript: null, attendees: null },
    );
    expect(result.sources).toEqual(["granola"]);
  });
});
