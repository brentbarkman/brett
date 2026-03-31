import OpenAI from "openai";
import type { StreamChunk } from "@brett/types";
import type { AIProvider, ChatParams, Message, ToolDefinition } from "./types.js";

function mapTools(
  tools: ToolDefinition[]
): OpenAI.Chat.Completions.ChatCompletionTool[] {
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}

function mapMessages(
  messages: Message[],
  system?: string
): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  const result: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];

  // Prepend system message if provided
  if (system) {
    result.push({ role: "system", content: system });
  }

  for (const m of messages) {
    if (m.role === "system") {
      result.push({ role: "system", content: m.content });
      continue;
    }

    if (m.role === "tool_result") {
      result.push({
        role: "tool",
        tool_call_id: m.toolCallId!,
        content: m.content,
      });
      continue;
    }

    if (m.role === "assistant" && m.toolCalls?.length) {
      const msg: OpenAI.Chat.Completions.ChatCompletionAssistantMessageParam = {
        role: "assistant",
        content: m.content || null,
        tool_calls: m.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function" as const,
          function: {
            name: tc.name,
            arguments: JSON.stringify(tc.args),
          },
        })),
      };
      result.push(msg);
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

export class OpenAIProvider implements AIProvider {
  readonly name = "openai";
  private client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey, maxRetries: 3 });
  }

  async *chat(params: ChatParams): AsyncIterable<StreamChunk> {
    const requestParams: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming = {
      model: params.model,
      messages: mapMessages(params.messages, params.system),
      stream: true,
      stream_options: { include_usage: true },
    };

    if (params.temperature !== undefined) {
      requestParams.temperature = params.temperature;
    }

    if (params.maxTokens !== undefined) {
      requestParams.max_tokens = params.maxTokens;
    }

    if (params.tools?.length) {
      requestParams.tools = mapTools(params.tools);
    }

    if (params.responseFormat?.type === "json_schema") {
      requestParams.response_format = {
        type: "json_schema",
        json_schema: {
          name: params.responseFormat.name,
          strict: true,
          schema: params.responseFormat.schema,
        },
      };
    } else if (params.responseFormat?.type === "json_object") {
      requestParams.response_format = { type: "json_object" };
    }

    const stream = await this.client.chat.completions.create(requestParams);

    // Accumulate tool calls by index
    const toolCallAccumulator = new Map<
      number,
      { id: string; name: string; argsJson: string }
    >();

    let doneEmitted = false;

    for await (const chunk of stream) {
      const choice = chunk.choices?.[0];

      if (choice) {
        const delta = choice.delta;

        // Text content
        if (delta?.content) {
          yield { type: "text", content: delta.content };
        }

        // Tool call deltas
        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index;
            if (!toolCallAccumulator.has(idx)) {
              toolCallAccumulator.set(idx, {
                id: tc.id ?? "",
                name: tc.function?.name ?? "",
                argsJson: "",
              });
            }
            const acc = toolCallAccumulator.get(idx)!;
            if (tc.id) acc.id = tc.id;
            if (tc.function?.name) acc.name = tc.function.name;
            if (tc.function?.arguments) acc.argsJson += tc.function.arguments;
          }
        }

        // On finish, emit accumulated tool calls
        if (
          choice.finish_reason === "tool_calls" ||
          choice.finish_reason === "stop"
        ) {
          for (const [, acc] of toolCallAccumulator) {
            let args: Record<string, unknown> = {};
            try {
              args = JSON.parse(acc.argsJson || "{}");
            } catch {
              // If parse fails, use empty object
            }
            yield {
              type: "tool_call",
              id: acc.id,
              name: acc.name,
              args,
            };
          }
          toolCallAccumulator.clear();
        }
      }

      // Usage info on final chunk
      if (chunk.usage) {
        doneEmitted = true;
        yield {
          type: "done",
          sessionId: "",
          usage: {
            input: chunk.usage.prompt_tokens,
            output: chunk.usage.completion_tokens,
          },
        };
      }
    }

    // Emit any remaining tool calls that weren't flushed
    if (toolCallAccumulator.size > 0) {
      for (const [, acc] of toolCallAccumulator) {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(acc.argsJson || "{}");
        } catch {
          // If parse fails, use empty object
        }
        yield {
          type: "tool_call",
          id: acc.id,
          name: acc.name,
          args,
        };
      }
      toolCallAccumulator.clear();
    }

    // Sentinel: if no done chunk was emitted during the stream, emit a fallback
    if (!doneEmitted) {
      yield { type: "done", sessionId: "", usage: { input: 0, output: 0 } };
    }
  }
}
