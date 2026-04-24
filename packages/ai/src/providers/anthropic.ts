import Anthropic from "@anthropic-ai/sdk";
import type { StreamChunk } from "@brett/types";
import type { AIProvider, ChatParams, Message, ToolDefinition } from "./types.js";

function mapTools(
  tools: ToolDefinition[]
): Anthropic.Messages.Tool[] {
  return tools.map((t, i) => {
    const tool: Anthropic.Messages.Tool = {
      name: t.name,
      description: t.description,
      input_schema: t.parameters as Anthropic.Messages.Tool.InputSchema,
    };
    // Cache breakpoint on the last tool — caches system prompt + all tools together.
    // Subsequent rounds in the same orchestration loop hit the cache (~90% cheaper).
    if (i === tools.length - 1) {
      tool.cache_control = { type: "ephemeral" };
    }
    return tool;
  });
}

function mapMessages(
  messages: Message[]
): Anthropic.Messages.MessageParam[] {
  const result: Anthropic.Messages.MessageParam[] = [];

  for (const m of messages) {
    // System messages are handled via the top-level system param, skip here
    if (m.role === "system") continue;

    if (m.role === "tool_result") {
      result.push({
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: m.toolCallId!,
            content: m.content,
          },
        ],
      });
      continue;
    }

    if (m.role === "assistant" && m.toolCalls?.length) {
      const content: Anthropic.Messages.ContentBlockParam[] = [];
      // Include text content if present
      if (m.content) {
        content.push({ type: "text", text: m.content });
      }
      for (const tc of m.toolCalls) {
        content.push({
          type: "tool_use",
          id: tc.id,
          name: tc.name,
          input: tc.args,
        });
      }
      result.push({ role: "assistant", content });
      continue;
    }

    // Normal user or assistant message
    result.push({
      role: m.role as "user" | "assistant",
      content: m.content,
    });
  }

  // Multi-round tool orchestration re-sends the full running history on each
  // request. The system prompt + tools already have a cache breakpoint (see
  // mapTools / `params.system`), but the accumulating messages don't — so
  // round N pays full price for the tool_results written in rounds 1..N-1.
  //
  // Add a cache breakpoint on the last content block of the last message so
  // each round's response creates a cache entry covering all prior messages.
  // The next round (which re-sends the same prefix) reads it at ~10% price.
  //
  // Anthropic allows up to 4 breakpoints; we use 2 (tools/system + last msg).
  if (result.length >= 2) {
    const last = result[result.length - 1];
    const block = toCacheableLastBlock(last.content);
    if (block) last.content = block;
  }

  return result;
}

/**
 * Ensure the final message's content is a content-block array with
 * `cache_control` on the last block. Returns the new content, or null if
 * the message can't be marked (e.g. already a primitive that's unsafe to
 * wrap).
 */
function toCacheableLastBlock(
  content: Anthropic.Messages.MessageParam["content"],
): Anthropic.Messages.MessageParam["content"] | null {
  if (typeof content === "string") {
    if (content.length === 0) return null;
    return [{ type: "text", text: content, cache_control: { type: "ephemeral" } }];
  }
  if (!Array.isArray(content) || content.length === 0) return null;
  const copy = content.slice();
  const lastIdx = copy.length - 1;
  const last = copy[lastIdx];
  // Cache breakpoints are not valid on `thinking` content blocks in the
  // SDK's type union. We never emit those from this provider (thinking is
  // a server-side concept we don't relay), so skip marking if we somehow
  // see one rather than producing an invalid request.
  if (last.type === "thinking" || last.type === "redacted_thinking") return copy;
  copy[lastIdx] = { ...last, cache_control: { type: "ephemeral" } } as typeof last;
  return copy;
}

export class AnthropicProvider implements AIProvider {
  readonly name = "anthropic";
  private client: Anthropic;

  constructor(apiKey: string) {
    // 2-minute timeout — long enough for extended thinking + the slowest
    // generations we allow, but short enough that a stuck stream doesn't
    // leak orchestrator generators or hold SSE connections open forever.
    this.client = new Anthropic({ apiKey, maxRetries: 3, timeout: 120_000 });
  }

  async *chat(params: ChatParams): AsyncIterable<StreamChunk> {
    const requestParams: Anthropic.Messages.MessageCreateParamsStreaming = {
      model: params.model,
      max_tokens: params.maxTokens ?? 4096,
      messages: mapMessages(params.messages),
      stream: true,
    };

    // Schema-constrained JSON: use native output_config (no text hint needed)
    if (params.responseFormat?.type === "json_schema") {
      requestParams.output_config = {
        format: { type: "json_schema", schema: params.responseFormat.schema },
      };
    }

    if (params.system) {
      // For json_object (hint-only), append text instruction. json_schema uses output_config above.
      const systemText = params.responseFormat?.type === "json_object"
        ? params.system + "\n\nYou must respond with valid JSON only. No other text."
        : params.system;

      // Pass system prompt as a cacheable text block.
      // If tools are present, the tool-level cache_control covers both system + tools.
      // If no tools, cache the system prompt directly.
      if (!params.tools?.length) {
        requestParams.system = [
          { type: "text", text: systemText, cache_control: { type: "ephemeral" } },
        ];
      } else {
        requestParams.system = systemText;
      }
    }

    if (params.temperature !== undefined) {
      requestParams.temperature = params.temperature;
    }

    if (params.tools?.length) {
      requestParams.tools = mapTools(params.tools);
    }

    const stream = this.client.messages.stream(requestParams);

    // Track tool calls being built up across content blocks
    let currentToolCall: { id: string; name: string; argsJson: string } | null = null;

    for await (const event of stream) {
      if (event.type === "content_block_start") {
        if (event.content_block.type === "tool_use") {
          currentToolCall = {
            id: event.content_block.id,
            name: event.content_block.name,
            argsJson: "",
          };
        }
      } else if (event.type === "content_block_delta") {
        if (event.delta.type === "text_delta") {
          yield { type: "text", content: event.delta.text };
        } else if (event.delta.type === "input_json_delta") {
          if (currentToolCall) {
            currentToolCall.argsJson += event.delta.partial_json;
          }
        }
      } else if (event.type === "content_block_stop") {
        if (currentToolCall) {
          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(currentToolCall.argsJson || "{}");
          } catch {
            // If parse fails, use empty object
          }
          yield {
            type: "tool_call",
            id: currentToolCall.id,
            name: currentToolCall.name,
            args,
          };
          currentToolCall = null;
        }
      }
    }

    // Get final message for usage stats (includes cache metrics)
    const finalMessage = await stream.finalMessage();
    const usage = finalMessage.usage;
    // Cache token fields exist on the usage object when prompt caching is active
    const usageAny = usage as unknown as Record<string, number>;
    yield {
      type: "done",
      sessionId: "",
      usage: {
        input: usage.input_tokens,
        output: usage.output_tokens,
        cacheCreation: usageAny.cache_creation_input_tokens ?? 0,
        cacheRead: usageAny.cache_read_input_tokens ?? 0,
      },
    };
  }
}
