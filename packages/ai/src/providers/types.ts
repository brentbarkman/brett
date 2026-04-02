import type { StreamChunk } from "@brett/types";

// Provider-agnostic message type. Each adapter maps this to its SDK format internally.
// No provider-specific shapes (ContentBlock, functionCall, etc.) leak into this type.
export interface Message {
  role: "user" | "assistant" | "system" | "tool_result";
  content: string;
  // For role="assistant" messages that contain tool calls:
  toolCalls?: Array<{ id: string; name: string; args: Record<string, unknown> }>;
  // For role="tool_result" messages:
  toolCallId?: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
}

export interface ChatParams {
  model: string;
  messages: Message[];
  tools?: ToolDefinition[];
  temperature?: number;
  maxTokens?: number;
  system?: string;
  /** Request JSON output from the model.
   *  - "json_object": hint-only, no schema enforcement
   *  - "json_schema": schema-constrained decoding (Anthropic/OpenAI enforce, Google falls back to hint)
   *    `name` is required by OpenAI; ignored by Anthropic/Google.
   */
  responseFormat?:
    | { type: "json_object" }
    | { type: "json_schema"; name: string; schema: Record<string, unknown> };
}

// Each adapter accepts the provider-agnostic Message format and maps
// it to the provider's wire format internally. This includes:
// - "system" messages → Anthropic: top-level system param; OpenAI: system role; Google: systemInstruction
// - "tool_result" messages → Anthropic: tool_result content block; OpenAI: role "tool"; Google: functionResponse
// - assistant messages with toolCalls → Anthropic: tool_use content blocks; OpenAI: tool_calls array; Google: functionCall parts
export interface AIProvider {
  readonly name: string;
  chat(params: ChatParams): AsyncIterable<StreamChunk>;
}

export interface EmbeddingProvider {
  embed(text: string, inputType?: "query" | "document"): Promise<number[]>;
  embedBatch(texts: string[], inputType?: "query" | "document"): Promise<number[][]>;
  readonly dimensions: number;
}
