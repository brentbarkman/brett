import { describe, it, expect } from "vitest";
import type { StreamChunk } from "@brett/types";
import { OpenAIProvider } from "../openai.js";

const API_KEY = process.env.OPENAI_API_KEY;

async function collectChunks(
  stream: AsyncIterable<StreamChunk>
): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return chunks;
}

describe.skipIf(!API_KEY)("OpenAIProvider", () => {
  it("streams a simple text response", async () => {
    const provider = new OpenAIProvider(API_KEY!);
    const chunks = await collectChunks(
      provider.chat({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: "Say hello in exactly 3 words." }],
        maxTokens: 100,
      })
    );

    const textChunks = chunks.filter((c) => c.type === "text");
    const doneChunks = chunks.filter((c) => c.type === "done");

    expect(textChunks.length).toBeGreaterThan(0);
    expect(doneChunks).toHaveLength(1);

    const done = doneChunks[0] as Extract<StreamChunk, { type: "done" }>;
    expect(done.usage.input).toBeGreaterThan(0);
    expect(done.usage.output).toBeGreaterThan(0);
  });

  it("handles tool calls", async () => {
    const provider = new OpenAIProvider(API_KEY!);
    const chunks = await collectChunks(
      provider.chat({
        model: "gpt-4o-mini",
        messages: [
          { role: "user", content: "What is 2 + 2? Use the calculator tool." },
        ],
        tools: [
          {
            name: "calculator",
            description: "Performs arithmetic. Call this to add numbers.",
            parameters: {
              type: "object",
              properties: {
                expression: {
                  type: "string",
                  description: "The math expression to evaluate",
                },
              },
              required: ["expression"],
            },
          },
        ],
        maxTokens: 300,
      })
    );

    const toolCallChunks = chunks.filter((c) => c.type === "tool_call");
    expect(toolCallChunks.length).toBeGreaterThan(0);

    const toolCall = toolCallChunks[0] as Extract<
      StreamChunk,
      { type: "tool_call" }
    >;
    expect(toolCall.name).toBe("calculator");
    expect(toolCall.id).toBeTruthy();
    expect(toolCall.args).toBeDefined();
  });
});
