import { describe, it, expect } from "vitest";
import { escapeDriveQuery, parseTranscriptDoc, parseMeetingNotesDoc } from "../lib/google-drive.js";

describe("escapeDriveQuery", () => {
  it("escapes single quotes", () => {
    expect(escapeDriveQuery("Alice's 1:1")).toBe("Alice\\'s 1:1");
  });

  it("handles multiple quotes", () => {
    expect(escapeDriveQuery("it's Bob's meeting")).toBe("it\\'s Bob\\'s meeting");
  });

  it("passes through clean strings", () => {
    expect(escapeDriveQuery("Weekly Standup")).toBe("Weekly Standup");
  });

  it("escapes backslashes", () => {
    expect(escapeDriveQuery("path\\to\\file")).toBe("path\\\\to\\\\file");
  });

  it("escapes both backslashes and single quotes", () => {
    expect(escapeDriveQuery("Alice\\'s file")).toBe("Alice\\\\\\'s file");
  });
});

describe("parseTranscriptDoc", () => {
  it("parses timestamped speaker turns", () => {
    const content = [
      { type: "paragraph", text: "[10:00:05] Alice" },
      { type: "paragraph", text: "Let's discuss the roadmap." },
      { type: "paragraph", text: "" },
      { type: "paragraph", text: "[10:00:30] Bob" },
      { type: "paragraph", text: "I'll take the API work." },
    ];
    const result = parseTranscriptDoc(content);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ source: "speaker", speaker: "Alice", text: "Let's discuss the roadmap." });
    expect(result[1]).toEqual({ source: "speaker", speaker: "Bob", text: "I'll take the API work." });
  });

  it("handles multi-line speaker turns", () => {
    const content = [
      { type: "paragraph", text: "[10:00:05] Alice" },
      { type: "paragraph", text: "First sentence." },
      { type: "paragraph", text: "Second sentence." },
      { type: "paragraph", text: "" },
      { type: "paragraph", text: "[10:01:00] Bob" },
      { type: "paragraph", text: "Response." },
    ];
    const result = parseTranscriptDoc(content);
    expect(result).toHaveLength(2);
    expect(result[0]!.text).toBe("First sentence. Second sentence.");
  });

  it("returns empty array for empty content", () => {
    expect(parseTranscriptDoc([])).toEqual([]);
  });
});

describe("parseMeetingNotesDoc", () => {
  it("flattens paragraphs to text", () => {
    const content = [
      { type: "paragraph", text: "Agenda" },
      { type: "paragraph", text: "- Item 1" },
      { type: "paragraph", text: "- Item 2" },
    ];
    expect(parseMeetingNotesDoc(content)).toBe("Agenda\n- Item 1\n- Item 2");
  });

  it("returns empty string for empty content", () => {
    expect(parseMeetingNotesDoc([])).toBe("");
  });
});

describe("escapeDriveQuery (extended)", () => {
  it("escapes backslashes before single quotes", () => {
    expect(escapeDriveQuery("path\\to\\'file")).toBe("path\\\\to\\\\\\'file");
  });
});

describe("parseTranscriptDoc (edge cases)", () => {
  it("ignores consecutive speaker headers with no text between them", () => {
    const content = [
      { type: "paragraph", text: "[10:00:05] Alice" },
      { type: "paragraph", text: "[10:00:10] Bob" },
      { type: "paragraph", text: "Hello" },
    ];
    const result = parseTranscriptDoc(content);
    // Alice has no text lines — should be skipped
    expect(result).toHaveLength(1);
    expect(result[0]!.speaker).toBe("Bob");
  });

  it("ignores text lines before the first speaker header", () => {
    const content = [
      { type: "paragraph", text: "This is a preamble" },
      { type: "paragraph", text: "[10:00:05] Alice" },
      { type: "paragraph", text: "Hello" },
    ];
    const result = parseTranscriptDoc(content);
    expect(result).toHaveLength(1);
    expect(result[0]!.speaker).toBe("Alice");
    expect(result[0]!.text).toBe("Hello");
  });
});
