import type { StreamChunk } from "@brett/types";

import { getApiUrl, getAuthHeaders } from "./client.js";

export async function* streamingFetch(
  path: string,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): AsyncGenerator<StreamChunk> {
  const apiUrl = getApiUrl();
  const authHeaders = await getAuthHeaders();

  // SECURITY: Validate message length
  const bodyStr = JSON.stringify(body);
  if (bodyStr.length > 50_000) {
    yield { type: "error", message: "Message too long" };
    return;
  }

  const response = await fetch(`${apiUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders,
    },
    body: bodyStr,
    signal,
    credentials: "include",
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: "Request failed" }));
    yield { type: "error", message: (error as { message?: string }).message || `HTTP ${response.status}` };
    return;
  }

  const reader = response.body?.getReader();
  if (!reader) {
    yield { type: "error", message: "No response body" };
    return;
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let currentEventType = "chunk"; // Track SSE event type

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      // Track event type from "event:" lines
      if (line.startsWith("event: ")) {
        currentEventType = line.slice(7).trim();
        continue;
      }
      if (line.startsWith("data: ")) {
        try {
          const parsed = JSON.parse(line.slice(6)) as StreamChunk;
          if (currentEventType === "error") {
            yield { type: "error", message: (parsed as { message?: string }).message || "Unknown error" };
          } else {
            yield parsed;
          }
        } catch {
          // Skip malformed lines
        }
        currentEventType = "chunk"; // Reset after consuming data
      }
    }
  }
}
