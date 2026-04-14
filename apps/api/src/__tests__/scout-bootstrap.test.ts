import { describe, it, expect } from "vitest";
import { parseMemoryUpdates } from "../lib/scout-memory.js";

/**
 * Bootstrap memory parsing tests.
 *
 * During bootstrap, a scout has no prior memories — validMemoryIds is an empty Set.
 * This means strengthen/weaken actions must always be filtered out (no valid IDs to
 * reference), and only "create" actions are allowed through.
 *
 * These tests verify that parseMemoryUpdates correctly enforces this constraint and
 * handles edge cases that are particularly relevant to the bootstrap path.
 */

describe("Bootstrap memory parsing", () => {
  it("only allows 'create' actions when validMemoryIds is empty", () => {
    const updates = [
      { action: "create", type: "factual", content: "Some fact", confidence: 0.8 },
      { action: "strengthen", memoryId: "mem_abc", confidence: 0.9 },
      { action: "weaken", memoryId: "mem_def", confidence: 0.3 },
      { action: "create", type: "pattern", content: "Some pattern", confidence: 0.7 },
    ];

    const parsed = parseMemoryUpdates(updates, new Set());
    expect(parsed).toHaveLength(2);
    expect(parsed.every(u => u.action === "create")).toBe(true);
  });

  it("clamps confidence values to 0-1 range", () => {
    const updates = [
      { action: "create", type: "factual", content: "Fact", confidence: 1.5 },
      { action: "create", type: "factual", content: "Fact2", confidence: -0.3 },
    ];

    const parsed = parseMemoryUpdates(updates, new Set());
    expect(parsed).toHaveLength(2);
    expect(parsed[0].action === "create" && parsed[0].confidence).toBe(1);
    expect(parsed[1].action === "create" && parsed[1].confidence).toBe(0);
  });

  it("truncates content to 500 characters", () => {
    const longContent = "a".repeat(600);
    const updates = [
      { action: "create", type: "factual", content: longContent, confidence: 0.8 },
    ];

    const parsed = parseMemoryUpdates(updates, new Set());
    expect(parsed).toHaveLength(1);
    if (parsed[0].action === "create") {
      expect(parsed[0].content.length).toBe(500);
    }
  });

  it("skips entries with invalid memory types", () => {
    const updates = [
      { action: "create", type: "invalid_type", content: "Some fact", confidence: 0.8 },
      { action: "create", type: "factual", content: "Valid fact", confidence: 0.7 },
    ];

    const parsed = parseMemoryUpdates(updates, new Set());
    expect(parsed).toHaveLength(1);
  });

  it("skips entries with empty content", () => {
    const updates = [
      { action: "create", type: "factual", content: "", confidence: 0.8 },
      { action: "create", type: "factual", content: "Valid", confidence: 0.7 },
    ];

    const parsed = parseMemoryUpdates(updates, new Set());
    expect(parsed).toHaveLength(1);
  });

  it("handles null/undefined updates gracefully", () => {
    expect(parseMemoryUpdates(null, new Set())).toEqual([]);
    expect(parseMemoryUpdates(undefined, new Set())).toEqual([]);
    expect(parseMemoryUpdates([], new Set())).toEqual([]);
  });

  it("handles malformed entries without crashing", () => {
    const updates = [
      null,
      undefined,
      "not an object",
      42,
      { action: "create" }, // missing type and content
      { action: "create", type: "factual", content: "Valid", confidence: 0.8 },
    ];

    const parsed = parseMemoryUpdates(updates as unknown[], new Set());
    expect(parsed).toHaveLength(1);
  });

  it("allows all three valid memory types during bootstrap", () => {
    const updates = [
      { action: "create", type: "factual", content: "A factual memory", confidence: 0.9 },
      { action: "create", type: "judgment", content: "A judgment memory", confidence: 0.7 },
      { action: "create", type: "pattern", content: "A pattern memory", confidence: 0.6 },
    ];

    const parsed = parseMemoryUpdates(updates, new Set());
    expect(parsed).toHaveLength(3);
    const types = parsed.map(u => u.action === "create" ? u.type : null);
    expect(types).toContain("factual");
    expect(types).toContain("judgment");
    expect(types).toContain("pattern");
  });

  it("defaults confidence to 0.5 when missing", () => {
    const updates = [
      { action: "create", type: "factual", content: "No confidence provided" },
    ];

    const parsed = parseMemoryUpdates(updates, new Set());
    expect(parsed).toHaveLength(1);
    expect(parsed[0].confidence).toBe(0.5);
  });

  it("filters out all strengthen/weaken even with plausible-looking IDs", () => {
    // Bootstrap has no prior memories — any memoryId reference is invalid
    const updates = [
      { action: "strengthen", memoryId: "mem_bootstrap_1", confidence: 0.9 },
      { action: "weaken", memoryId: "mem_bootstrap_2", confidence: 0.3 },
    ];

    const parsed = parseMemoryUpdates(updates, new Set());
    expect(parsed).toHaveLength(0);
  });
});
