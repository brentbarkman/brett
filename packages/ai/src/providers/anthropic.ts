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

  return result;
}

export class AnthropicProvider implements AIProvider {
  readonly name = "anthropic";
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async *chat(params: ChatParams): AsyncIterable<StreamChunk> {
    const requestParams: Anthropic.Messages.MessageCreateParamsStreaming = {
      model: params.model,
      max_tokens: params.maxTokens ?? 4096,
      messages: mapMessages(params.messages),
      stream: true,
    };

    if (params.system) {
      // Anthropic doesn't have native JSON mode — append a hint when requested.
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
