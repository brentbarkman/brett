import { describe, it, expect } from "vitest";
import {
  assembleItemText,
  assembleContentText,
  assembleEventText,
  assembleMeetingNoteText,
  assembleFindingText,
  assembleConversationText,
} from "../embedding/assembler.js";

describe("assembleItemText", () => {
  it("task with all fields", () => {
    const result = assembleItemText({
      title: "Review budget",
      description: "Check Q3 numbers",
      notes: "Ask Jordan about forecasts",
    });
    expect(result).toEqual([
      "[Task] Review budget\nCheck Q3 numbers\nAsk Jordan about forecasts",
    ]);
  });

  it("null description and notes", () => {
    const result = assembleItemText({
      title: "Simple task",
      description: null,
      notes: null,
    });
    expect(result).toEqual(["[Task] Simple task"]);
  });

  it("empty strings omitted", () => {
    const result = assembleItemText({
      title: "Task",
      description: "",
      notes: "",
    });
    expect(result).toEqual(["[Task] Task"]);
  });
});

describe("assembleContentText", () => {
  it("content with body produces multiple chunks", () => {
    const longBody = "Word ".repeat(2000); // well beyond chunk size
    const result = assembleContentText({
      type: "article",
      title: "My Article",
      contentTitle: "The Real Title",
      contentDescription: "A summary",
      contentBody: longBody,
    });
    expect(result.length).toBeGreaterThan(1);
    expect(result[0]).toContain("[Content: article]");
    expect(result[0]).toContain("The Real Title");
  });

  it("content without body produces single chunk", () => {
    const result = assembleContentText({
      type: "web_page",
      title: "My Page",
      contentTitle: null,
      contentDescription: "A brief description",
      contentBody: null,
    });
    expect(result).toHaveLength(1);
    expect(result[0]).toContain("[Content: web_page]");
  });
});

describe("assembleEventText", () => {
  it("event with all fields", () => {
    const result = assembleEventText({
      title: "1:1 with Jordan",
      description: "Weekly sync on hiring",
      location: "Zoom",
    });
    expect(result).toEqual([
      "[Meeting] 1:1 with Jordan\nWeekly sync on hiring\nLocation: Zoom",
    ]);
  });

  it("null description and location", () => {
    const result = assembleEventText({
      title: "Standup",
      description: null,
      location: null,
    });
    expect(result).toEqual(["[Meeting] Standup"]);
  });
});

describe("assembleMeetingNoteText", () => {
  it("meeting note with transcript produces multiple chunks", () => {
    const longTranscript = [
      { speaker: "Alice", text: "Word ".repeat(500) },
      { speaker: "Bob", text: "Word ".repeat(500) },
    ];
    const result = assembleMeetingNoteText({
      title: "Q3 Review",
      summary: "Discussed Q3 results",
      transcript: longTranscript,
    });
    expect(result.length).toBeGreaterThan(1);
    expect(result[0]).toContain("[Meeting Notes]");
    expect(result[0]).toContain("Discussed Q3 results");
  });

  it("meeting note without transcript produces single chunk", () => {
    const result = assembleMeetingNoteText({
      title: "Quick Sync",
      summary: "Brief catch-up",
      transcript: null,
    });
    expect(result).toHaveLength(1);
    expect(result[0]).toContain("[Meeting Notes]");
    expect(result[0]).toContain("Quick Sync");
  });
});

describe("assembleFindingText", () => {
  it("finding with all fields produces single chunk with required labels", () => {
    const result = assembleFindingText({
      title: "Competitor launched new product",
      description: "Acme Corp released a new AI tool targeting our market",
      reasoning: "Directly relevant to our product roadmap",
    });
    expect(result).toHaveLength(1);
    expect(result[0]).toContain("[Scout Finding]");
    expect(result[0]).toContain("Competitor launched new product");
    expect(result[0]).toContain("Relevance:");
    expect(result[0]).toContain("Directly relevant to our product roadmap");
  });
});

describe("assembleConversationText", () => {
  it("user+assistant messages produce single chunk with role prefixes", () => {
    const messages = [
      { role: "user", content: "What should I work on today?" },
      { role: "assistant", content: "I recommend starting with the budget review." },
    ];
    const result = assembleConversationText(messages);
    expect(result).toHaveLength(1);
    expect(result[0]).toContain("user:");
    expect(result[0]).toContain("assistant:");
  });

  it("filters out tool_call and tool_result roles", () => {
    const messages = [
      { role: "user", content: "Hello" },
      { role: "tool_call", content: "search(...)" },
      { role: "tool_result", content: "results..." },
      { role: "assistant", content: "Here is what I found." },
    ];
    const result = assembleConversationText(messages);
    expect(result[0]).not.toContain("tool_call");
    expect(result[0]).not.toContain("tool_result");
    expect(result[0]).toContain("user:");
    expect(result[0]).toContain("assistant:");
  });

  it("truncates to 8000 chars", () => {
    const messages = [
      { role: "user", content: "a".repeat(5000) },
      { role: "assistant", content: "b".repeat(5000) },
    ];
    const result = assembleConversationText(messages);
    expect(result[0].length).toBeLessThanOrEqual(8000);
  });
});
