import Anthropic from "@anthropic-ai/sdk";
import type { StreamChunk } from "@brett/types";
import type { AIProvider, ChatParams, Message, ToolDefinition } from "./types.js";

function mapTools(
  tools: ToolDefinition[]
): Anthropic.Messages.Tool[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters as Anthropic.Messages.Tool.InputSchema,
  }));
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
      requestParams.system = params.system;
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

    // Get final message for usage stats
    const finalMessage = await stream.finalMessage();
    yield {
      type: "done",
      sessionId: "",
      usage: {
        input: finalMessage.usage.input_tokens,
        output: finalMessage.usage.output_tokens,
      },
    };
  }
}
