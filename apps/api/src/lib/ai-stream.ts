import { orchestrate, extractFacts, enqueueEmbed, extractGraph, upsertGraph } from "@brett/ai";
import { prisma } from "./prisma.js";
import { getEmbeddingProvider } from "./embedding-provider.js";
import type { AIProvider } from "@brett/ai";
import type { AIProviderName, StreamChunk } from "@brett/types";

/** Retry an async fn up to maxRetries times with exponential backoff (1s, 2s, 4s). */
async function withRetry<T>(fn: () => Promise<T>, label: string, maxRetries = 2): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries) {
        const delay = 1000 * 2 ** attempt;
        console.warn(`[ai-stream] ${label} attempt ${attempt + 1} failed, retrying in ${delay}ms:`, (err as Error).message);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastError;
}

/**
 * Build a ReadableStream that pipes orchestrator chunks as SSE events.
 *
 * After the stream completes, it fires-and-forgets:
 *   - Updating modelUsed on the session
 *   - Persisting the assistant message
 *   - Extracting facts (if memoryCtx provided)
 *   - Calling opts.onDone (if provided)
 *
 * On error, marks the session with modelUsed = "error:<reason>".
 */
export function buildStream(
  params: Parameters<typeof orchestrate>[0],
  sessionId: string,
  opts?: {
    memoryCtx?: { userId: string; provider: AIProvider; providerName: AIProviderName; itemContext?: string; assistantName?: string };
    onDone?: (content: string) => void;
  },
): { stream: ReadableStream; assistantContentRef: { value: string } } {
  const encoder = new TextEncoder();
  const assistantContentRef = { value: "" };

  const stream = new ReadableStream({
    async start(controller) {
      let streamModel = "";
      let hadError = false;

      try {
        for await (const chunk of orchestrate(params)) {
          // Intercept error chunks from the orchestrator — never forward raw error details to the client
          if (chunk.type === "error") {
            console.error("[ai-stream] Orchestrator error chunk:", chunk.message);
            hadError = true;
            const safeError = { type: "error", message: "Something went wrong. Please try again." };
            controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify(safeError)}\n\n`));
            continue;
          }
          if (chunk.type === "text") {
            assistantContentRef.value += chunk.content;
          }
          // Capture model from done chunk
          if (chunk.type === "done" && chunk.model) {
            streamModel = chunk.model;
          }
          // Persist tool result messages so subsequent messages in the session
          // have context about what Brett found/did.
          if (chunk.type === "tool_result") {
            console.log(`[ai-stream] tool_result: message=${!!chunk.message} hint=${chunk.displayHint?.type ?? "none"}`);
            if (chunk.message) {
              assistantContentRef.value += chunk.message + "\n";
            }
          }
          const data = `event: chunk\ndata: ${JSON.stringify(chunk)}\n\n`;
          controller.enqueue(encoder.encode(data));
        }
        controller.close();

        // Update session with the actual model used
        if (streamModel) {
          prisma.conversationSession
            .update({ where: { id: sessionId }, data: { modelUsed: streamModel } })
            .catch((err) => console.error("[ai-stream] Failed to update modelUsed:", err));
        }

        // Fire-and-forget: store assistant response
        if (assistantContentRef.value.trim()) {
          prisma.conversationMessage
            .create({
              data: {
                sessionId,
                role: "assistant",
                content: assistantContentRef.value,
              },
            })
            .then(() => {
              const memoryCtx = opts?.memoryCtx;
              if (memoryCtx) {
                console.log("[ai-stream] Memory pipelines firing for session", sessionId);
                enqueueEmbed({ entityType: "conversation", entityId: sessionId, userId: memoryCtx.userId });
                withRetry(
                  () => extractFacts(sessionId, memoryCtx.userId, memoryCtx.provider, memoryCtx.providerName, prisma, memoryCtx.itemContext, memoryCtx.assistantName),
                  "fact-extraction",
                )
                  .then(() => console.log("[fact-extraction] Complete for session", sessionId))
                  .catch((err) => console.error("[fact-extraction] Failed after retries:", err.message));
                withRetry(
                  () => extractGraph(assistantContentRef.value, memoryCtx.userId, memoryCtx.provider, memoryCtx.providerName, prisma, { type: "conversation", entityId: sessionId }),
                  "graph-extraction",
                )
                  .then((result) => {
                    console.log("[graph-extraction] Complete:", result.entities.length, "entities,", result.relationships.length, "relationships");
                    if (result.entities.length > 0 || result.relationships.length > 0) {
                      upsertGraph(memoryCtx.userId, result, prisma, getEmbeddingProvider(), { type: "conversation", entityId: sessionId })
                        .catch((err) => console.error("[graph-upsert]", err.message));
                    }
                  })
                  .catch((err) => console.error("[graph-extraction] Failed after retries:", err.message));
              }

              if (opts?.onDone) {
                try {
                  opts.onDone(assistantContentRef.value);
                } catch (err) {
                  console.error("onDone callback failed:", err);
                }
              }
            })
            .catch((err: unknown) =>
              console.error("Failed to store assistant message:", err),
            );
        } else if (hadError) {
          // Stream completed but produced no content — mark as failed
          prisma.conversationSession
            .update({ where: { id: sessionId }, data: { modelUsed: streamModel || "error:no-output" } })
            .catch(() => {});
        }
      } catch (err) {
        console.error("[ai-stream] Stream error:", err);

        // Mark session as failed with error reason
        // Sanitize error to prevent API key leakage into the database
        const rawReason = err instanceof Error ? err.message.slice(0, 100) : "unknown";
        const reason = rawReason
          .replace(/(?:sk-|key-|bearer\s+)[a-zA-Z0-9_-]{20,}/gi, "[REDACTED]")
          .replace(/\b[a-zA-Z0-9_-]{40,}\b/g, "[REDACTED]");
        prisma.conversationSession
          .update({ where: { id: sessionId }, data: { modelUsed: `error:${reason}` } })
          .catch(() => {});

        const errorChunk: StreamChunk = {
          type: "error",
          message: "Something went wrong. Please try again.",
        };
        try {
          controller.enqueue(
            encoder.encode(
              `event: error\ndata: ${JSON.stringify(errorChunk)}\n\n`,
            ),
          );
          controller.close();
        } catch {
          /* controller already closed */
        }
      }
    },
  });

  return { stream, assistantContentRef };
}

export function sseResponse(stream: ReadableStream): Response {
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
