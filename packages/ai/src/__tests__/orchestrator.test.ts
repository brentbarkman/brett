import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AIProvider, ChatParams } from "../providers/types.js";
import type { StreamChunk } from "@brett/types";
import type { Skill } from "../skills/types.js";
import { SkillRegistry } from "../skills/registry.js";
import { orchestrate, type OrchestratorParams } from "../orchestrator.js";

// ─── Mock assembleContext so we don't need real Prisma / system prompts ───

vi.mock("../context/assembler.js", () => ({
  assembleContext: vi.fn().mockResolvedValue({
    system: "You are Brett.",
    messages: [{ role: "user", content: "hello" }],
    modelTier: "small",
  }),
}));

vi.mock("../router.js", () => ({
  resolveModel: vi.fn((_provider: string, tier: string) => `mock-${tier}`),
}));

// ─── Mock provider ───

class MockProvider implements AIProvider {
  readonly name = "mock";
  private responses: StreamChunk[][];
  public callCount = 0;

  constructor(responses: StreamChunk[][]) {
    this.responses = responses;
  }

  async *chat(_params: ChatParams): AsyncIterable<StreamChunk> {
    this.callCount++;
    const response = this.responses.shift() || [];
    for (const chunk of response) yield chunk;
  }
}

// ─── Test skill ───

function makeSkill(overrides: Partial<Skill> = {}): Skill {
  return {
    name: "test_skill",
    description: "A test skill",
    parameters: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
    modelTier: "small",
    requiresAI: false,
    execute: vi.fn().mockResolvedValue({
      success: true,
      data: { result: "done" },
      message: "Executed successfully",
    }),
    ...overrides,
  };
}

// ─── Mock Prisma ───

const mockPrisma = {
  userFact: { findMany: vi.fn().mockResolvedValue([]) },
  conversationSession: {
    findMany: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue({ id: "session-1" }),
  },
  conversationMessage: {
    create: vi.fn().mockResolvedValue({}),
  },
} as any;

// ─── Helpers ───

function makeParams(
  provider: MockProvider,
  registry: SkillRegistry,
  sessionId = "test-session"
): OrchestratorParams {
  return {
    input: {
      type: "omnibar",
      userId: "user-1",
      message: "hello",
    },
    provider,
    providerName: "anthropic",
    prisma: mockPrisma,
    registry,
    sessionId,
  };
}

async function collectChunks(
  gen: AsyncIterable<StreamChunk>
): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = [];
  for await (const chunk of gen) {
    chunks.push(chunk);
  }
  return chunks;
}

// ─── Tests ───

describe("orchestrate", () => {
  let registry: SkillRegistry;

  beforeEach(() => {
    vi.clearAllMocks();
    registry = new SkillRegistry();
  });

  it("yields text chunks and a done chunk for a simple text response", async () => {
    const provider = new MockProvider([
      [
        { type: "text", content: "Hello " },
        { type: "text", content: "world!" },
        { type: "done", sessionId: "", usage: { input: 100, output: 50 } },
      ],
    ]);

    const chunks = await collectChunks(orchestrate(makeParams(provider, registry)));

    expect(chunks.filter((c) => c.type === "text")).toHaveLength(2);
    expect(chunks[0]).toEqual({ type: "text", content: "Hello " });
    expect(chunks[1]).toEqual({ type: "text", content: "world!" });

    const done = chunks.find((c) => c.type === "done");
    expect(done).toBeDefined();
    expect(done!.type).toBe("done");
  });

  it("handles a single tool call: yields tool_call, executes skill, yields tool_result, then follow-up text", async () => {
    const skill = makeSkill();
    registry.register(skill);

    const provider = new MockProvider([
      // Round 1: LLM produces a tool call
      [
        {
          type: "tool_call",
          id: "tc-1",
          name: "test_skill",
          args: { query: "test" },
        },
        { type: "done", sessionId: "", usage: { input: 100, output: 50 } },
      ],
      // Round 2: LLM produces text follow-up
      [
        { type: "text", content: "Here are the results." },
        { type: "done", sessionId: "", usage: { input: 80, output: 30 } },
      ],
    ]);

    const chunks = await collectChunks(orchestrate(makeParams(provider, registry)));

    const types = chunks.map((c) => c.type);
    expect(types).toContain("tool_call");
    expect(types).toContain("tool_result");
    expect(types).toContain("text");
    expect(types[types.length - 1]).toBe("done");

    // Skill was executed
    expect(skill.execute).toHaveBeenCalledWith(
      { query: "test" },
      expect.objectContaining({ userId: "user-1", prisma: mockPrisma })
    );

    // tool_result comes after tool_call
    const tcIdx = types.indexOf("tool_call");
    const trIdx = types.indexOf("tool_result");
    expect(trIdx).toBeGreaterThan(tcIdx);
  });

  it("returns validation error for invalid tool call args", async () => {
    const skill = makeSkill();
    registry.register(skill);

    const provider = new MockProvider([
      // LLM calls skill with missing required "query" arg
      [
        {
          type: "tool_call",
          id: "tc-1",
          name: "test_skill",
          args: {}, // missing required "query"
        },
        { type: "done", sessionId: "", usage: { input: 100, output: 50 } },
      ],
      // Follow-up after error
      [
        { type: "text", content: "Sorry, let me try again." },
        { type: "done", sessionId: "", usage: { input: 80, output: 30 } },
      ],
    ]);

    const chunks = await collectChunks(orchestrate(makeParams(provider, registry)));

    const toolResult = chunks.find((c) => c.type === "tool_result") as any;
    expect(toolResult).toBeDefined();
    expect(toolResult.message).toContain("Invalid arguments");
    expect(toolResult.data).toBeNull();

    // Skill execute should NOT have been called
    expect(skill.execute).not.toHaveBeenCalled();
  });

  it("handles unknown skill gracefully", async () => {
    // Registry is empty — no skills registered
    const provider = new MockProvider([
      [
        {
          type: "tool_call",
          id: "tc-1",
          name: "nonexistent_skill",
          args: {},
        },
        { type: "done", sessionId: "", usage: { input: 100, output: 50 } },
      ],
      [
        { type: "text", content: "I couldn't find that skill." },
        { type: "done", sessionId: "", usage: { input: 80, output: 30 } },
      ],
    ]);

    const chunks = await collectChunks(orchestrate(makeParams(provider, registry)));

    const toolResult = chunks.find((c) => c.type === "tool_result") as any;
    expect(toolResult).toBeDefined();
    expect(toolResult.message).toContain("Unknown skill");
  });

  it("escalates model tier after first tool call round", async () => {
    const { resolveModel } = await import("../router.js");
    const skill = makeSkill();
    registry.register(skill);

    const provider = new MockProvider([
      [
        {
          type: "tool_call",
          id: "tc-1",
          name: "test_skill",
          args: { query: "test" },
        },
        { type: "done", sessionId: "", usage: { input: 100, output: 50 } },
      ],
      [
        { type: "text", content: "Done." },
        { type: "done", sessionId: "", usage: { input: 80, output: 30 } },
      ],
    ]);

    await collectChunks(orchestrate(makeParams(provider, registry)));

    // First call should use "small", second call (after escalation) should use "medium"
    expect(resolveModel).toHaveBeenCalledTimes(2);
    expect(resolveModel).toHaveBeenNthCalledWith(1, "anthropic", "small");
    expect(resolveModel).toHaveBeenNthCalledWith(2, "anthropic", "medium");
  });

  it("exits with truncation text when token budget is exceeded", async () => {
    const skill = makeSkill();
    registry.register(skill);

    const provider = new MockProvider([
      [
        {
          type: "tool_call",
          id: "tc-1",
          name: "test_skill",
          args: { query: "test" },
        },
        // Report usage that exceeds budget (50,000 total)
        {
          type: "done",
          sessionId: "",
          usage: { input: 40_000, output: 15_000 },
        },
      ],
    ]);

    const chunks = await collectChunks(orchestrate(makeParams(provider, registry)));

    const textChunks = chunks.filter((c) => c.type === "text") as any[];
    const truncationText = textChunks.find((c: any) =>
      c.content.includes("token budget exceeded")
    );
    expect(truncationText).toBeDefined();

    // Done chunk should always be emitted
    const doneChunks = chunks.filter((c) => c.type === "done");
    expect(doneChunks.length).toBe(1);
  });

  it("exits after max tool rounds with truncation message", async () => {
    const skill = makeSkill();
    registry.register(skill);

    // Build 5 rounds of tool calls + 1 follow-up (which shouldn't be reached)
    const responses: StreamChunk[][] = [];
    for (let i = 0; i < 6; i++) {
      responses.push([
        {
          type: "tool_call",
          id: `tc-${i}`,
          name: "test_skill",
          args: { query: "test" },
        },
        { type: "done", sessionId: "", usage: { input: 100, output: 50 } },
      ]);
    }

    const provider = new MockProvider(responses);
    const chunks = await collectChunks(orchestrate(makeParams(provider, registry)));

    // Should have stopped at 5 rounds
    expect(provider.callCount).toBe(5);

    const textChunks = chunks.filter((c) => c.type === "text") as any[];
    const truncationText = textChunks.find((c: any) =>
      c.content.includes("maximum tool call rounds")
    );
    expect(truncationText).toBeDefined();

    // Done chunk emitted
    const doneChunks = chunks.filter((c) => c.type === "done");
    expect(doneChunks.length).toBe(1);
  });

  it("sanitizes API key patterns from error messages", async () => {
    const provider = new MockProvider([
      [
        {
          type: "error",
          message: "Auth failed with sk-abcdef1234567890abcdefghij",
        },
      ],
    ]);

    const chunks = await collectChunks(orchestrate(makeParams(provider, registry)));

    const errorChunk = chunks.find((c) => c.type === "error") as any;
    expect(errorChunk).toBeDefined();
    expect(errorChunk.message).toContain("[REDACTED]");
    expect(errorChunk.message).not.toContain("sk-abcdef");
  });

  it("emits a done chunk even when an error is thrown", async () => {
    // Provider that throws
    const throwingProvider: AIProvider = {
      name: "throwing",
      async *chat(): AsyncIterable<StreamChunk> {
        throw new Error("Connection lost with bearer abc12345678901234567890123");
      },
    };

    const chunks = await collectChunks(
      orchestrate(makeParams(throwingProvider as any, registry))
    );

    const errorChunk = chunks.find((c) => c.type === "error") as any;
    expect(errorChunk).toBeDefined();
    expect(errorChunk.message).not.toContain("abc12345678901234567890123");

    // Done chunk is still emitted
    const doneChunks = chunks.filter((c) => c.type === "done");
    expect(doneChunks.length).toBe(1);
  });

  it("always emits exactly one done chunk on normal completion", async () => {
    const provider = new MockProvider([
      [
        { type: "text", content: "Hi" },
        { type: "done", sessionId: "", usage: { input: 10, output: 5 } },
      ],
    ]);

    const chunks = await collectChunks(orchestrate(makeParams(provider, registry)));
    const doneChunks = chunks.filter((c) => c.type === "done");
    expect(doneChunks).toHaveLength(1);
  });
});
