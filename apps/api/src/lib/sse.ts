import type { SSEEvent } from "@brett/types";

interface SSEConnection {
  controller: ReadableStreamDefaultController;
  userId: string;
  cleanup: () => void;
}

const connections = new Map<string, SSEConnection[]>();

export function addSSEConnection(
  userId: string,
  controller: ReadableStreamDefaultController,
): () => void {
  const conn: SSEConnection = { controller, userId, cleanup: () => {} };
  const userConns = connections.get(userId) ?? [];
  userConns.push(conn);
  connections.set(userId, userConns);

  const cleanup = () => {
    const conns = connections.get(userId);
    if (conns) {
      const idx = conns.indexOf(conn);
      if (idx !== -1) conns.splice(idx, 1);
      if (conns.length === 0) connections.delete(userId);
    }
  };

  conn.cleanup = cleanup;
  return cleanup;
}

export function publishSSE(userId: string, event: SSEEvent): void {
  const conns = connections.get(userId);
  if (!conns) return;

  const data = `event: ${event.type}\ndata: ${JSON.stringify(event.payload)}\n\n`;
  const encoder = new TextEncoder();
  const chunk = encoder.encode(data);

  const dead: SSEConnection[] = [];
  for (const conn of conns) {
    try {
      conn.controller.enqueue(chunk);
    } catch {
      dead.push(conn);
    }
  }
  for (const conn of dead) conn.cleanup();
}

export function sendHeartbeats(): void {
  const encoder = new TextEncoder();
  const chunk = encoder.encode(": heartbeat\n\n");

  const dead: SSEConnection[] = [];
  for (const conns of connections.values()) {
    for (const conn of conns) {
      try {
        conn.controller.enqueue(chunk);
      } catch {
        dead.push(conn);
      }
    }
  }
  for (const conn of dead) conn.cleanup();
}

export function getConnectionCount(): number {
  let count = 0;
  for (const conns of connections.values()) count += conns.length;
  return count;
}
