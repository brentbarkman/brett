/**
 * Wire-format test for the connection.synced SSE event.
 *
 * Replaced the post-OAuth burst polling on the desktop client (every 2-3s
 * for two minutes after a Granola/Calendar OAuth) with a server-side event.
 * If the wire format ever drifts, the desktop's `EventSource.addEventListener
 * ("connection.synced", ...)` silently stops firing and the client never
 * picks up that the OAuth-initiated initial sync completed.
 *
 * The corresponding client handler lives in apps/desktop/src/api/sse.ts and
 * is exercised by apps/desktop/src/api/__tests__/sse.test.tsx.
 */
import { describe, it, expect } from "vitest";
import { addSSEConnection, publishSSE } from "../lib/sse.js";
import type { SSEEvent } from "@brett/types";

function captureFrames(): {
  controller: ReadableStreamDefaultController;
  frames: string[];
  cleanup: () => void;
} {
  const frames: string[] = [];
  const decoder = new TextDecoder();
  const controller = {
    enqueue: (chunk: Uint8Array) => {
      frames.push(decoder.decode(chunk));
    },
    close: () => {},
    error: () => {},
    desiredSize: 1,
  } as unknown as ReadableStreamDefaultController;
  const cleanup = addSSEConnection("user_emit_test", controller);
  return { controller, frames, cleanup };
}

describe("publishSSE — connection.synced wire format", () => {
  it("emits a parseable SSE frame with type and payload", () => {
    const { frames, cleanup } = captureFrames();

    const event: SSEEvent = {
      type: "connection.synced",
      payload: { type: "google-calendar", googleAccountId: "ga_1" },
    };
    publishSSE("user_emit_test", event);

    expect(frames).toHaveLength(1);
    const frame = frames[0]!;
    expect(frame).toContain("event: connection.synced\n");
    expect(frame).toMatch(/data: .+\n\n$/);

    const dataLine = frame.split("\n").find((l) => l.startsWith("data: "))!;
    const payload = JSON.parse(dataLine.slice("data: ".length));
    expect(payload).toEqual({ type: "google-calendar", googleAccountId: "ga_1" });

    cleanup();
  });

  it("supports the granola payload shape", () => {
    const { frames, cleanup } = captureFrames();

    publishSSE("user_emit_test", {
      type: "connection.synced",
      payload: { type: "granola" },
    });

    expect(frames).toHaveLength(1);
    const dataLine = frames[0]!.split("\n").find((l) => l.startsWith("data: "))!;
    expect(JSON.parse(dataLine.slice("data: ".length))).toEqual({ type: "granola" });

    cleanup();
  });
});
