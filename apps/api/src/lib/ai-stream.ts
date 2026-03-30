import { orchestrate, extractFacts } from "@brett/ai";
import { prisma } from "./prisma.js";
import type { AIProvider } from "@brett/ai";
import type { AIProviderName, StreamChunk } from "@brett/types";

/**
 * Build a ReadableStream that pipes orchestrator chunks as SSE events.
 *
 * After the stream completes, it fires-and-forgets:
 *   - Persisting the assistant message
 *   - Extracting facts (if memoryCtx provided)
 *   - Embedding the conversation (if memoryCtx provided and OpenAI key exists)
 *   - Calling opts.onDone (if provided)
 */
export function buildStream(
  params: Parameters<typeof orchestrate>[0],
  sessionId: string,
  opts?: {
    memoryCtx?: { userId: string; provider: AIProvider; providerName: AIProviderName };
    onDone?: (content: string) => void;
  },
): { stream: ReadableStream; assistantContentRef: { value: string } } {
  const encoder = new TextEncoder();
  const assistantContentRef = { value: "" };

  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of orchestrate(params)) {
          if (chunk.type === "text") {
            assistantContentRef.value += chunk.content;
          }
          // Persist tool result messages so subsequent messages in the session
          // have context about what Brett found/did. Without this, the LLM
          // loses context about meetings, search results, etc. between turns.
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
                // Fire-and-forget: extract facts
                extractFacts(sessionId, memoryCtx.userId, memoryCtx.provider, memoryCtx.providerName, prisma)
                  .catch((err) => console.error("[fact-extraction] Failed:", err.message));

                // Embeddings disabled — OpenAI-only strategy doesn't work for non-OpenAI users.
                // Layer C (vector memory) deferred until multi-provider embedding strategy is designed.
                // Raw logs (Layer A) + structured facts (Layer B) provide memory without embeddings.
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
        }
      } catch (err) {
        console.error("[ai-stream] Stream error:", err);
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
