import {
  GoogleGenerativeAI,
  HarmBlockThreshold,
  HarmCategory,
  type Content,
  type FunctionDeclarationSchema,
  type FunctionDeclarationsTool,
  type Part,
} from "@google/generative-ai";
import { randomUUID } from "crypto";
import type { StreamChunk } from "@brett/types";
import type { AIProvider, ChatParams, Message, ToolDefinition } from "./types.js";

function mapTools(tools: ToolDefinition[]): FunctionDeclarationsTool[] {
  return [
    {
      functionDeclarations: tools.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters as unknown as FunctionDeclarationSchema,
      })),
    },
  ];
}

function mapMessages(messages: Message[]): Content[] {
  const result: Content[] = [];

  for (const m of messages) {
    // System messages handled via systemInstruction
    if (m.role === "system") continue;

    if (m.role === "tool_result") {
      let responseData: Record<string, unknown>;
      try {
        const parsed = JSON.parse(m.content);
        responseData = typeof parsed === "object" && parsed !== null ? parsed : { result: parsed };
      } catch {
        responseData = { result: m.content };
      }

      // Find the function name from the previous assistant message's tool calls
      // For now, we'll store it as a generic response — the name is required by Gemini
      // We need to look back in the messages to find the matching tool call
      const functionName = findFunctionName(messages, m.toolCallId!);

      result.push({
        role: "function",
        parts: [
          {
            functionResponse: {
              name: functionName,
              response: responseData,
            },
          },
        ],
      });
      continue;
    }

    if (m.role === "assistant" && m.toolCalls?.length) {
      const parts: Part[] = [];
      if (m.content) {
        parts.push({ text: m.content });
      }
      for (const tc of m.toolCalls) {
        parts.push({
          functionCall: {
            name: tc.name,
            args: tc.args,
          },
        });
      }
      result.push({ role: "model", parts });
      continue;
    }

    // Normal user or assistant
    const role = m.role === "assistant" ? "model" : "user";
    result.push({
      role,
      parts: [{ text: m.content }],
    });
  }

  return result;
}

/** Look backwards through messages to find the function name for a given tool call ID */
function findFunctionName(messages: Message[], toolCallId: string): string {
  for (const m of messages) {
    if (m.role === "assistant" && m.toolCalls) {
      for (const tc of m.toolCalls) {
        if (tc.id === toolCallId) return tc.name;
      }
    }
  }
  return "unknown_function";
}

export class GoogleProvider implements AIProvider {
  readonly name = "google";
  private genAI: GoogleGenerativeAI;

  constructor(apiKey: string) {
    this.genAI = new GoogleGenerativeAI(apiKey);
  }

  async *chat(params: ChatParams): AsyncIterable<StreamChunk> {
    const modelConfig: {
      model: string;
      systemInstruction?: string;
      tools?: FunctionDeclarationsTool[];
      safetySettings?: Array<{
        category: HarmCategory;
        threshold: HarmBlockThreshold;
      }>;
    } = {
      model: params.model,
      safetySettings: [
        { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
      ],
    };

    if (params.system) {
      modelConfig.systemInstruction = params.system;
    }

    if (params.tools?.length) {
      modelConfig.tools = mapTools(params.tools);
    }

    const model = this.genAI.getGenerativeModel(modelConfig);

    const contents = mapMessages(params.messages);

    const generationConfig: { temperature?: number; maxOutputTokens?: number; responseMimeType?: string } = {};
    if (params.temperature !== undefined) {
      generationConfig.temperature = params.temperature;
    }
    if (params.maxTokens !== undefined) {
      generationConfig.maxOutputTokens = params.maxTokens;
    }
    if (params.responseFormat?.type === "json_object") {
      generationConfig.responseMimeType = "application/json";
    }

    const streamResult = await model.generateContentStream({
      contents,
      generationConfig,
    });

    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    for await (const chunk of streamResult.stream) {
      // Track usage if available
      const usageMetadata = chunk.usageMetadata;
      if (usageMetadata) {
        totalInputTokens = usageMetadata.promptTokenCount ?? 0;
        totalOutputTokens = usageMetadata.candidatesTokenCount ?? 0;
      }

      const candidate = chunk.candidates?.[0];
      if (!candidate?.content?.parts) continue;

      for (const part of candidate.content.parts) {
        if ("text" in part && part.text) {
          yield { type: "text", content: part.text };
        }

        if ("functionCall" in part && part.functionCall) {
          yield {
            type: "tool_call",
            id: randomUUID(),
            name: part.functionCall.name,
            args: (part.functionCall.args ?? {}) as Record<string, unknown>,
          };
        }
      }
    }

    yield {
      type: "done",
      sessionId: "",
      usage: {
        input: totalInputTokens,
        output: totalOutputTokens,
      },
    };
  }
}
