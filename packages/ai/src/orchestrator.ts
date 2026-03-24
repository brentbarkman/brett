import type { AIProvider, Message } from "./providers/types.js";
import type { AIProviderName, ModelTier, StreamChunk } from "@brett/types";
import type { PrismaClient } from "@prisma/client";
import { resolveModel } from "./router.js";
import { SkillRegistry } from "./skills/registry.js";
import { validateSkillArgs } from "./skills/validate-args.js";
import type { AssemblerInput } from "./context/assembler.js";
import { assembleContext } from "./context/assembler.js";

// ─── Constants ───

const MAX_ROUNDS = 5;
const MAX_TOTAL_TOKENS = 50_000;
const MAX_TOOL_RESULT_SIZE = 4096; // 4KB

// Matches common API key patterns (Bearer tokens, sk-*, key-*, etc.)
const API_KEY_PATTERN = /(?:sk-|key-|bearer\s+)[a-zA-Z0-9_-]{20,}/gi;

// ─── Types ───

export interface OrchestratorParams {
  input: AssemblerInput;
  provider: AIProvider;
  providerName: AIProviderName;
  prisma: PrismaClient;
  registry: SkillRegistry;
  sessionId?: string;
}

// ─── Helpers ───

function sanitizeError(message: string): string {
  return message.replace(API_KEY_PATTERN, "[REDACTED]");
}

function truncateResult(result: string): string {
  if (result.length <= MAX_TOOL_RESULT_SIZE) return result;
  return result.slice(0, MAX_TOOL_RESULT_SIZE) + "\n...[truncated]";
}

function escalateTier(tier: ModelTier): ModelTier {
  return tier === "small" ? "medium" : tier;
}

// ─── Orchestrator ───

export async function* orchestrate(
  params: OrchestratorParams
): AsyncIterable<StreamChunk> {
  const { input, provider, providerName, prisma, registry, sessionId } =
    params;

  try {
    // 1. Assemble context
    const ctx = await assembleContext(input, prisma);
    const messages: Message[] = [...ctx.messages];
    const system = ctx.system;
    let currentTier: ModelTier = ctx.modelTier;

    const tools = registry.toToolDefinitions();
    let totalTokens = 0;
    let round = 0;
    let truncatedExit = false;

    // 2. Tool call loop
    while (round < MAX_ROUNDS) {
      round++;

      const model = resolveModel(providerName, currentTier);

      // Collect tool calls and text from this round
      const pendingToolCalls: Array<{
        id: string;
        name: string;
        args: Record<string, unknown>;
      }> = [];
      let continueLoop = false;

      for await (const chunk of provider.chat({
        model,
        messages,
        tools: tools.length > 0 ? tools : undefined,
        system,
      })) {
        switch (chunk.type) {
          case "text":
            yield chunk;
            break;

          case "tool_call":
            pendingToolCalls.push({
              id: chunk.id,
              name: chunk.name,
              args: chunk.args,
            });
            yield chunk;
            break;

          case "done": {
            // Track token usage
            totalTokens += chunk.usage.input + chunk.usage.output;

            if (pendingToolCalls.length > 0) {
              // Add assistant message with tool calls to history
              messages.push({
                role: "assistant",
                content: "",
                toolCalls: pendingToolCalls.map((tc) => ({
                  id: tc.id,
                  name: tc.name,
                  args: tc.args,
                })),
              });

              // Execute each tool call
              for (const tc of pendingToolCalls) {
                const skill = registry.get(tc.name);

                if (!skill) {
                  const errorResult = `Unknown skill: ${tc.name}`;
                  yield {
                    type: "tool_result",
                    id: tc.id,
                    data: null,
                    message: errorResult,
                  };
                  messages.push({
                    role: "tool_result",
                    content: errorResult,
                    toolCallId: tc.id,
                  });
                  continue;
                }

                // Validate args against skill's JSON schema
                const validation = validateSkillArgs(skill.parameters, tc.args);
                if (!validation.valid) {
                  const errorResult = `Invalid arguments: ${validation.errors}`;
                  yield {
                    type: "tool_result",
                    id: tc.id,
                    data: null,
                    message: errorResult,
                  };
                  messages.push({
                    role: "tool_result",
                    content: errorResult,
                    toolCallId: tc.id,
                  });
                  continue;
                }

                // Execute the skill
                const userId =
                  "userId" in input ? (input.userId as string) : "";
                const result = await skill.execute(tc.args, {
                  userId,
                  prisma,
                  provider,
                });

                // Yield tool result with display hint
                yield {
                  type: "tool_result",
                  id: tc.id,
                  data: result.data ?? null,
                  displayHint: result.displayHint,
                  message: result.message,
                };

                // Truncate large results before adding to message history
                const resultStr = JSON.stringify({
                  success: result.success,
                  data: result.data,
                  message: result.message,
                });
                messages.push({
                  role: "tool_result",
                  content: truncateResult(resultStr),
                  toolCallId: tc.id,
                });
              }

              // Escalate tier after first tool call round
              currentTier = escalateTier(currentTier);

              // Check token budget before continuing
              if (totalTokens > MAX_TOTAL_TOKENS) {
                truncatedExit = true;
                break;
              }

              continueLoop = true;
            } else {
              // No tool calls — we're done
              yield {
                type: "done",
                sessionId: sessionId ?? "",
                usage: { input: totalTokens, output: 0 },
              };
              return;
            }
            break;
          }

          case "error":
            yield { type: "error", message: sanitizeError(chunk.message) };
            return;
        }
      }

      if (truncatedExit) break;
      if (!continueLoop) break;
    }

    // 3. Guaranteed done chunk on max-rounds or token-budget exit
    if (truncatedExit) {
      yield { type: "text", content: "\n\n_Response truncated: token budget exceeded._" };
    } else if (round >= MAX_ROUNDS) {
      yield { type: "text", content: "\n\n_Response truncated: maximum tool call rounds reached._" };
    }

    yield {
      type: "done",
      sessionId: sessionId ?? "",
      usage: { input: totalTokens, output: 0 },
    };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Unknown orchestrator error";
    yield { type: "error", message: sanitizeError(message) };
    // Guaranteed done chunk even on error
    yield {
      type: "done",
      sessionId: sessionId ?? "",
      usage: { input: 0, output: 0 },
    };
  }
}
