// ────────────────────────────────────────────────────────────────────────────
// SSE Client — foreground real-time connection
//
// Scaffold implementation: connects to the SSE stream, triggers a full sync
// when the connection drops and reconnects. Individual event parsing is a
// future enhancement (react-native-sse or similar).
//
// Flow:
//   1. POST /events/ticket  → get a short-lived ticket
//   2. GET  /events/stream?ticket={ticket}  → hold the connection
//   3. On disconnect → trigger sync() to catch up via cursors, then reconnect
//   4. AppState active  → connect
//   4. AppState background → disconnect
// ────────────────────────────────────────────────────────────────────────────

import { AppState, AppStateStatus } from "react-native";
import { getToken } from "../auth/token-storage";
import { getApiUrl } from "./client";

let reconnectAttempts = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let currentConnection: AbortController | null = null;
let appStateSubscription: ReturnType<typeof AppState.addEventListener> | null =
  null;

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Start the SSE client.
 *
 * - Connects immediately if a token is available
 * - Reconnects on foreground, disconnects on background
 * - Returns a cleanup function that tears down everything
 *
 * @param onEvent  Called when the connection drops (triggers a sync cycle)
 */
export function startSSE(onEvent: () => void): () => void {
  connect(onEvent);

  appStateSubscription = AppState.addEventListener(
    "change",
    (state: AppStateStatus) => {
      if (state === "active") {
        connect(onEvent);
      } else if (state === "background") {
        disconnect();
      }
    },
  );

  return () => {
    disconnect();
    appStateSubscription?.remove();
    appStateSubscription = null;
  };
}

/**
 * Stop the SSE client and cancel any pending reconnect.
 * Safe to call multiple times.
 */
export function stopSSE(): void {
  disconnect();
}

// ── Internal ─────────────────────────────────────────────────────────────────

async function connect(onEvent: () => void): Promise<void> {
  disconnect(); // tear down any previous connection first

  const token = await getToken();
  if (!token) return;

  const apiUrl = getApiUrl();

  try {
    // Step 1: exchange bearer token for a short-lived SSE ticket
    const ticketRes = await fetch(`${apiUrl}/events/ticket`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
    });

    if (!ticketRes.ok) return;

    const { ticket } = (await ticketRes.json()) as { ticket: string };

    // Step 2: open the stream using the ticket (no bearer token on the stream
    // URL — the ticket acts as the credential to avoid CORS preflight issues)
    const controller = new AbortController();
    currentConnection = controller;

    const response = await fetch(
      `${apiUrl}/events/stream?ticket=${ticket}`,
      {
        headers: { Accept: "text/event-stream" },
        signal: controller.signal,
      },
    );

    if (!response.ok) {
      throw new Error(`SSE connection failed: ${response.status}`);
    }

    // Successful connection — reset backoff counter
    reconnectAttempts = 0;

    // Scaffold: React Native's fetch does not expose ReadableStream in all
    // environments, so we use response.text() which resolves when the server
    // closes the connection. On close we trigger a sync to catch up via
    // delta cursors, then schedule a reconnect.
    //
    // For production-grade event parsing, replace this with react-native-sse
    // or a native EventSource that yields individual SSE events.
    response
      .text()
      .then(() => {
        if (!controller.signal.aborted) {
          onEvent(); // catch up on any missed changes
          scheduleReconnect(onEvent);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          scheduleReconnect(onEvent);
        }
      });
  } catch (err: unknown) {
    const isAbort =
      err instanceof Error && err.name === "AbortError";
    if (!isAbort) {
      scheduleReconnect(onEvent);
    }
  }
}

function disconnect(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (currentConnection) {
    currentConnection.abort();
    currentConnection = null;
  }
}

function scheduleReconnect(onEvent: () => void): void {
  if (reconnectTimer) return; // already scheduled

  // Exponential backoff: 1s, 2s, 4s, 8s, 16s, 30s (capped)
  const backoff = Math.min(1_000 * Math.pow(2, reconnectAttempts), 30_000);
  reconnectAttempts++;

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect(onEvent);
  }, backoff);
}
