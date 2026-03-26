import type { AIProvider, Message } from "./providers/types.js";
import type { AIProviderName, ModelTier, StreamChunk } from "@brett/types";
import type { PrismaClient } from "@prisma/client";
import { resolveModel } from "./router.js";
import { SkillRegistry } from "./skills/registry.js";
import { validateSkillArgs } from "./skills/validate-args.js";
import type { AssemblerInput } from "./context/assembler.js";
import { assembleContext } from "./context/assembler.js";
import { AI_CONFIG } from "./config.js";
import { logUsage } from "./memory/usage.js";

// ─── Constants ───

const MAX_ROUNDS = AI_CONFIG.orchestrator.maxRounds;
const MAX_TOTAL_TOKENS = AI_CONFIG.orchestrator.maxTotalTokens;
const MAX_TOOL_RESULT_SIZE = AI_CONFIG.orchestrator.maxToolResultSize;

// Matches common API key patterns (Bearer tokens, sk-*, key-*, etc.)
const API_KEY_PATTERN = /(?:sk-|key-|bearer\s+)[a-zA-Z0-9_-]{20,}/gi;
// Catches long alphanumeric strings that look like tokens/secrets (32+ chars, mixed case/digits)
const HIGH_ENTROPY_PATTERN = /\b[a-zA-Z0-9_-]{40,}\b/g;

// ─── Types ───

export interface OrchestratorParams {
  input: AssemblerInput;
  provider: AIProvider;
  providerName: AIProviderName;
  prisma: PrismaClient;
  registry: SkillRegistry;
  sessionId?: string;
  logUsage?: boolean;
  /** Called when a content item is created and needs extraction */
  onContentCreated?: (itemId: string, sourceUrl: string) => void;
}

// ─── Helpers ───

function sanitizeError(message: string): string {
  // Layer 1: Known key prefixes (sk-, key-, bearer)
  let sanitized = message.replace(API_KEY_PATTERN, "[REDACTED]");
  // Layer 2: Long high-entropy strings that look like tokens/secrets
  sanitized = sanitized.replace(HIGH_ENTROPY_PATTERN, "[REDACTED]");
  return sanitized;
}

function truncateResult(result: string): string {
  if (result.length <= MAX_TOOL_RESULT_SIZE) return result;
  return result.slice(0, MAX_TOOL_RESULT_SIZE) + "\n...[truncated]";
}

// Simple tool calls (single lookup/create) don't need model escalation.
// Only escalate when the LLM needs to reason about tool results.
const SIMPLE_TOOLS = new Set([
  "list_today", "list_upcoming", "list_inbox", "get_list_items",
  "get_calendar_events", "get_next_event", "up_next", "get_stats",
  "get_item_detail", "create_task", "complete_task", "search_things",
]);

// Fire-and-forget actions — the tool result + displayHint is the full response.
// No need for a follow-up LLM call to generate a confirmation message.
// The skill's `message` field IS the confirmation. Saves ~2,500 tokens per action.
const FIRE_AND_FORGET_TOOLS = new Set([
  "create_task", "create_content", "create_list",
  "complete_task", "move_to_list", "snooze_item", "archive_list",
  "update_item", "change_settings", "submit_feedback",
]);

function shouldEscalate(pendingToolCalls: Array<{ name: string }>): boolean {
  // Don't escalate if all tool calls are simple lookups/creates
  if (pendingToolCalls.every((tc) => SIMPLE_TOOLS.has(tc.name))) return false;
  // Escalate for complex tools that need reasoning about results
  return true;
}

function escalateTier(tier: ModelTier, pendingToolCalls: Array<{ name: string }>): ModelTier {
  if (tier !== "small") return tier;
  return shouldEscalate(pendingToolCalls) ? "medium" : tier;
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

    // Context-aware tool selection: only send tools relevant to the user's message.
    // Saves ~1,000 tokens per request vs sending all 21 tools every time.
    const userMessage = "message" in input ? (input as { message: string }).message : "";
    const tools = userMessage
      ? registry.toToolDefinitionsForMessage(userMessage)
      : registry.toToolDefinitions();
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalCacheCreationTokens = 0;
    let totalCacheReadTokens = 0;
    let round = 0;
    let truncatedExit = false;
    let hasYieldedText = false;

    // Buffer for fire-and-forget confirmations — yielded as one summary at the end
    const bufferedConfirmations: Array<{
      id: string;
      data: unknown;
      displayHint?: import("@brett/types").DisplayHint;
      message?: string;
    }> = [];

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
            hasYieldedText = true;
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
            // Track token usage separately
            totalInputTokens += chunk.usage.input;
            totalOutputTokens += chunk.usage.output;
            totalCacheCreationTokens += chunk.usage.cacheCreation ?? 0;
            totalCacheReadTokens += chunk.usage.cacheRead ?? 0;

            // Log per-round usage (reuse `model` from top of loop)
            if (params.logUsage !== false) {
              logUsage(prisma, {
                userId: "userId" in input ? (input.userId as string) : "",
                sessionId: params.sessionId,
                provider: providerName,
                model,
                modelTier: currentTier,
                source: input.type,
                inputTokens: chunk.usage.input,
                outputTokens: chunk.usage.output,
                cacheCreationTokens: chunk.usage.cacheCreation ?? 0,
                cacheReadTokens: chunk.usage.cacheRead ?? 0,
              }).catch(() => {});
            }

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
                  onContentCreated: params.onContentCreated,
                });

                // Buffer fire-and-forget results; yield others immediately.
                // Fire-and-forget confirmations are batched and yielded as a
                // single summary at the end of the sequence.
                if (FIRE_AND_FORGET_TOOLS.has(tc.name)) {
                  bufferedConfirmations.push({
                    id: tc.id,
                    data: result.data ?? null,
                    displayHint: result.displayHint,
                    message: result.message,
                  });
                } else {
                  yield {
                    type: "tool_result",
                    id: tc.id,
                    data: result.data ?? null,
                    displayHint: result.displayHint,
                    message: result.message,
                  };
                }

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

              // If ALL tool calls are fire-and-forget, the skill results ARE the response.
              // Flush the buffer and exit — no follow-up LLM round needed.
              // This handles single actions, batch actions (create 6 tasks), and
              // multi-step chains where the final round is all fire-and-forget.
              // Saves ~2,500+ tokens by skipping round 2 entirely.
              const allFireAndForget = pendingToolCalls.every(
                (tc) => FIRE_AND_FORGET_TOOLS.has(tc.name)
              );

              if (allFireAndForget) {
                if (bufferedConfirmations.length > 0) {
                  const combinedMessage = bufferedConfirmations
                    .map((c) => c.message)
                    .filter(Boolean)
                    .join("\n");
                  yield {
                    type: "tool_result" as const,
                    id: bufferedConfirmations[bufferedConfirmations.length - 1].id,
                    data: bufferedConfirmations.map((c) => c.data),
                    displayHint: { type: "confirmation" as const, message: combinedMessage },
                    message: combinedMessage,
                  };
                  bufferedConfirmations.length = 0;
                }
                yield {
                  type: "done",
                  sessionId: sessionId ?? "",
                  usage: { input: totalInputTokens, output: totalOutputTokens, cacheCreation: totalCacheCreationTokens, cacheRead: totalCacheReadTokens },
                };
                return;
              }

              // Escalate tier only if tool calls require reasoning
              currentTier = escalateTier(currentTier, pendingToolCalls);

              // Check token budget before continuing
              if (totalInputTokens + totalOutputTokens > MAX_TOTAL_TOKENS) {
                truncatedExit = true;
                break;
              }

              // Yield a separator before the next LLM round so text doesn't run together
              // Only if we already yielded text — otherwise it creates a blank first line
              if (hasYieldedText) {
                yield { type: "text" as const, content: "\n\n" };
              }

              continueLoop = true;
            } else {
              // No tool calls — we're done
              yield {
                type: "done",
                sessionId: sessionId ?? "",
                usage: { input: totalInputTokens, output: totalOutputTokens, cacheCreation: totalCacheCreationTokens, cacheRead: totalCacheReadTokens },
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
      usage: { input: totalInputTokens, output: totalOutputTokens, cacheCreation: totalCacheCreationTokens, cacheRead: totalCacheReadTokens },
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
