import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  estimateTokens,
  formatMemoriesForPrompt,
  parseMemoryUpdates,
  buildConsolidationPrompt,
} from "../lib/scout-memory.js";

// ── estimateTokens ──

describe("estimateTokens", () => {
  it("returns ceil(length / 4) for typical text", () => {
    expect(estimateTokens("hello")).toBe(2); // 5/4 = 1.25 -> 2
  });

  it("returns 0 for empty string", () => {
    expect(estimateTokens("")).toBe(0);
  });

  it("returns 1 for a single character", () => {
    expect(estimateTokens("a")).toBe(1); // 1/4 = 0.25 -> 1
  });

  it("returns exact value for length divisible by 4", () => {
    expect(estimateTokens("abcd")).toBe(1); // 4/4 = 1
  });

  it("handles long strings", () => {
    const text = "a".repeat(1000);
    expect(estimateTokens(text)).toBe(250);
  });
});

// ── formatMemoriesForPrompt ──

describe("formatMemoriesForPrompt", () => {
  const memories = [
    { id: "mem_abc123", type: "factual" as const, confidence: 0.9, content: "EU AI Act entered into force August 1, 2024" },
    { id: "mem_def456", type: "judgment" as const, confidence: 0.8, content: "User prefers policy documents over opinion pieces" },
    { id: "mem_ghi789", type: "pattern" as const, confidence: 0.7, content: "High-relevance findings tend to come from Reuters" },
  ];

  it("formats memories with ID, type, confidence, and content", () => {
    const result = formatMemoriesForPrompt(memories);
    expect(result).toContain("[mem_abc123] (factual, confidence: 0.9)");
    expect(result).toContain("EU AI Act entered into force August 1, 2024");
    expect(result).toContain("[mem_def456] (judgment, confidence: 0.8)");
    expect(result).toContain("User prefers policy documents over opinion pieces");
  });

  it("returns empty string for empty array", () => {
    expect(formatMemoriesForPrompt([])).toBe("");
  });

  it("returns empty string for undefined input", () => {
    expect(formatMemoriesForPrompt(undefined as any)).toBe("");
  });

  it("respects token budget — stops before exceeding", () => {
    // Each formatted memory is roughly:
    // "[mem_abc123] (factual, confidence: 0.9) EU AI Act..." ~ 70 chars ~ 18 tokens
    // With a very small budget, only the first should fit
    const result = formatMemoriesForPrompt(memories, 25);
    // Should include first memory
    expect(result).toContain("mem_abc123");
    // Should NOT include third memory (would exceed budget)
    expect(result).not.toContain("mem_ghi789");
  });

  it("uses default ~1000 token budget", () => {
    // With 3 short memories, all should fit within 1000 tokens
    const result = formatMemoriesForPrompt(memories);
    expect(result).toContain("mem_abc123");
    expect(result).toContain("mem_def456");
    expect(result).toContain("mem_ghi789");
  });

  it("includes all memories when budget is generous", () => {
    const result = formatMemoriesForPrompt(memories, 10000);
    expect(result).toContain("mem_abc123");
    expect(result).toContain("mem_def456");
    expect(result).toContain("mem_ghi789");
  });

  it("returns empty string when first memory exceeds budget", () => {
    // Budget of 1 token (4 chars) — no memory can fit
    const result = formatMemoriesForPrompt(memories, 1);
    expect(result).toBe("");
  });
});

// ── parseMemoryUpdates ──

describe("parseMemoryUpdates", () => {
  const validMemoryIds = new Set(["mem_1", "mem_2", "mem_3"]);

  it("parses valid create action", () => {
    const updates = [
      { action: "create", type: "factual", content: "Some new fact", confidence: 0.85 },
    ];
    const result = parseMemoryUpdates(updates, validMemoryIds);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      action: "create",
      type: "factual",
      content: "Some new fact",
      confidence: 0.85,
    });
  });

  it("parses valid strengthen action", () => {
    const updates = [
      { action: "strengthen", memoryId: "mem_1", confidence: 0.95 },
    ];
    const result = parseMemoryUpdates(updates, validMemoryIds);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      action: "strengthen",
      memoryId: "mem_1",
      confidence: 0.95,
    });
  });

  it("parses valid weaken action", () => {
    const updates = [
      { action: "weaken", memoryId: "mem_2", confidence: 0.3 },
    ];
    const result = parseMemoryUpdates(updates, validMemoryIds);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      action: "weaken",
      memoryId: "mem_2",
      confidence: 0.3,
    });
  });

  it("parses mixed actions", () => {
    const updates = [
      { action: "create", type: "judgment", content: "User cares about X", confidence: 0.7 },
      { action: "strengthen", memoryId: "mem_1", confidence: 0.9 },
      { action: "weaken", memoryId: "mem_3", confidence: 0.2 },
    ];
    const result = parseMemoryUpdates(updates, validMemoryIds);
    expect(result).toHaveLength(3);
    expect(result[0]!.action).toBe("create");
    expect(result[1]!.action).toBe("strengthen");
    expect(result[2]!.action).toBe("weaken");
  });

  it("skips strengthen with invalid memoryId", () => {
    const updates = [
      { action: "strengthen", memoryId: "mem_nonexistent", confidence: 0.9 },
    ];
    const result = parseMemoryUpdates(updates, validMemoryIds);
    expect(result).toHaveLength(0);
  });

  it("skips weaken with invalid memoryId", () => {
    const updates = [
      { action: "weaken", memoryId: "mem_nonexistent", confidence: 0.5 },
    ];
    const result = parseMemoryUpdates(updates, validMemoryIds);
    expect(result).toHaveLength(0);
  });

  it("clamps confidence above 1 to 1", () => {
    const updates = [
      { action: "create", type: "factual", content: "Test", confidence: 1.5 },
    ];
    const result = parseMemoryUpdates(updates, validMemoryIds);
    expect(result[0]!.confidence).toBe(1);
  });

  it("clamps confidence below 0 to 0", () => {
    const updates = [
      { action: "create", type: "factual", content: "Test", confidence: -0.5 },
    ];
    const result = parseMemoryUpdates(updates, validMemoryIds);
    expect(result[0]!.confidence).toBe(0);
  });

  it("clamps confidence for strengthen/weaken too", () => {
    const updates = [
      { action: "strengthen", memoryId: "mem_1", confidence: 2.0 },
      { action: "weaken", memoryId: "mem_2", confidence: -1.0 },
    ];
    const result = parseMemoryUpdates(updates, validMemoryIds);
    expect(result[0]!.confidence).toBe(1);
    expect(result[1]!.confidence).toBe(0);
  });

  it("truncates content to 500 characters", () => {
    const longContent = "x".repeat(600);
    const updates = [
      { action: "create", type: "pattern", content: longContent, confidence: 0.5 },
    ];
    const result = parseMemoryUpdates(updates, validMemoryIds);
    expect((result[0] as any).content).toHaveLength(500);
  });

  it("rejects invalid type for create", () => {
    const updates = [
      { action: "create", type: "invalid_type", content: "Test", confidence: 0.5 },
    ];
    const result = parseMemoryUpdates(updates, validMemoryIds);
    expect(result).toHaveLength(0);
  });

  it("rejects create without content", () => {
    const updates = [
      { action: "create", type: "factual", confidence: 0.5 },
    ];
    const result = parseMemoryUpdates(updates, validMemoryIds);
    expect(result).toHaveLength(0);
  });

  it("rejects create without type", () => {
    const updates = [
      { action: "create", content: "Test", confidence: 0.5 },
    ];
    const result = parseMemoryUpdates(updates, validMemoryIds);
    expect(result).toHaveLength(0);
  });

  it("skips unknown action types", () => {
    const updates = [
      { action: "delete", memoryId: "mem_1" },
    ];
    const result = parseMemoryUpdates(updates, validMemoryIds);
    expect(result).toHaveLength(0);
  });

  it("handles empty array", () => {
    const result = parseMemoryUpdates([], validMemoryIds);
    expect(result).toHaveLength(0);
  });

  it("handles null/undefined input", () => {
    expect(parseMemoryUpdates(null as any, validMemoryIds)).toHaveLength(0);
    expect(parseMemoryUpdates(undefined as any, validMemoryIds)).toHaveLength(0);
  });

  it("handles non-array input", () => {
    expect(parseMemoryUpdates("not an array" as any, validMemoryIds)).toHaveLength(0);
  });

  it("skips entries that are not objects", () => {
    const updates = [null, undefined, 42, "string", { action: "create", type: "factual", content: "Valid", confidence: 0.5 }];
    const result = parseMemoryUpdates(updates as any, validMemoryIds);
    expect(result).toHaveLength(1);
    expect(result[0]!.action).toBe("create");
  });

  it("defaults confidence to 0.5 when missing for create", () => {
    const updates = [
      { action: "create", type: "factual", content: "Test" },
    ];
    const result = parseMemoryUpdates(updates, validMemoryIds);
    expect(result).toHaveLength(1);
    expect(result[0]!.confidence).toBe(0.5);
  });
});

// ── buildConsolidationPrompt ──

describe("buildConsolidationPrompt", () => {
  const scout = {
    id: "scout_1",
    name: "AI Policy Tracker",
    goal: "Track EU AI regulation developments",
    context: "Focused on the AI Act implementation timeline",
  };

  const memories = [
    { id: "mem_1", type: "factual" as const, confidence: 0.9, content: "EU AI Act entered into force August 1, 2024", status: "active" as const },
    { id: "mem_2", type: "judgment" as const, confidence: 0.7, content: "User prefers primary sources over analysis", status: "active" as const },
  ];

  const feedbackSummary = "2 useful, 1 not useful";
  const runSummary = "3 runs, 5 findings total";

  it("returns system and user messages", () => {
    const result = buildConsolidationPrompt(scout, memories, feedbackSummary, runSummary);
    expect(result).toHaveProperty("system");
    expect(result).toHaveProperty("user");
    expect(typeof result.system).toBe("string");
    expect(typeof result.user).toBe("string");
  });

  it("system message instructs LLM to synthesize memories", () => {
    const { system } = buildConsolidationPrompt(scout, memories, feedbackSummary, runSummary);
    expect(system.toLowerCase()).toContain("memor");
    // Should mention the available actions
    expect(system).toContain("create");
    expect(system).toContain("supersede");
    expect(system).toContain("keep");
    expect(system).toContain("remove");
  });

  it("user message includes scout goal and context", () => {
    const { user } = buildConsolidationPrompt(scout, memories, feedbackSummary, runSummary);
    expect(user).toContain("Track EU AI regulation developments");
    expect(user).toContain("AI Act implementation timeline");
  });

  it("user message includes current memories with IDs", () => {
    const { user } = buildConsolidationPrompt(scout, memories, feedbackSummary, runSummary);
    expect(user).toContain("mem_1");
    expect(user).toContain("mem_2");
    expect(user).toContain("EU AI Act entered into force August 1, 2024");
    expect(user).toContain("User prefers primary sources over analysis");
  });

  it("user message includes feedback summary", () => {
    const { user } = buildConsolidationPrompt(scout, memories, feedbackSummary, runSummary);
    expect(user).toContain("2 useful, 1 not useful");
  });

  it("user message includes run summary", () => {
    const { user } = buildConsolidationPrompt(scout, memories, feedbackSummary, runSummary);
    expect(user).toContain("3 runs, 5 findings total");
  });

  it("handles scout without context", () => {
    const noContextScout = { ...scout, context: null };
    const { user } = buildConsolidationPrompt(noContextScout, memories, feedbackSummary, runSummary);
    expect(user).toContain("Track EU AI regulation developments");
    // Should not contain undefined or null literal
    expect(user).not.toContain("undefined");
    expect(user).not.toContain("null");
  });

  it("handles empty memories array", () => {
    const { user } = buildConsolidationPrompt(scout, [], feedbackSummary, runSummary);
    expect(user).toContain("Track EU AI regulation developments");
    // Should still be valid
    expect(typeof user).toBe("string");
  });

  it("handles empty feedback and run summaries", () => {
    const { user } = buildConsolidationPrompt(scout, memories, "", "");
    expect(user).toContain("Track EU AI regulation developments");
    expect(typeof user).toBe("string");
  });
});

// ── DB-dependent functions (integration tests — require Postgres) ──

describe.skip("applyMemoryUpdates (integration — requires Postgres)", () => {
  it("creates new ScoutMemory records for create actions", async () => {
    // Would test: applyMemoryUpdates(scoutId, runId, [{ action: "create", ... }])
    // Then verify: prisma.scoutMemory.findMany({ where: { scoutId } })
  });

  it("updates confidence for strengthen actions", async () => {
    // Would test: existing memory -> applyMemoryUpdates with strengthen -> verify confidence bumped
  });

  it("updates confidence for weaken actions", async () => {
    // Would test: existing memory -> applyMemoryUpdates with weaken -> verify confidence lowered
  });
});

describe.skip("getActiveMemories (integration — requires Postgres)", () => {
  it("returns active memories ordered by confidence DESC", async () => {
    // Would test: insert several memories with varying confidence/status
    // getActiveMemories should return only active, sorted by confidence
  });

  it("excludes non-active memories", async () => {
    // Insert memories with status superseded, removed — should not appear
  });
});

describe.skip("incrementAndCheckConsolidation (integration — requires Postgres)", () => {
  it("increments consolidationRunCount atomically", async () => {
    // Would test: call incrementAndCheckConsolidation, verify count incremented
  });

  it("returns shouldConsolidate: true when count reaches threshold", async () => {
    // Set count to threshold - 1, call, verify shouldConsolidate
  });

  it("returns shouldConsolidate: false when below threshold", async () => {
    // Set count to 0, call, verify shouldConsolidate is false
  });
});

describe.skip("runConsolidation (integration — requires Postgres + LLM mock)", () => {
  it("creates ScoutConsolidation record and applies mutations", async () => {
    // Full integration test with mocked collectChatFn and extractJSONFn
  });

  it("enforces token budget cap after consolidation", async () => {
    // Test that memories exceeding ~1000 tokens are trimmed
  });

  it("marks consolidation as failed on error without resetting run count", async () => {
    // Test error handling path
  });
});
