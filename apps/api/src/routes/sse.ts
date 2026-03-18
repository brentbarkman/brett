import { Hono } from "hono";
import { randomBytes } from "node:crypto";
import { addSSEConnection } from "../lib/sse.js";
import { auth } from "../lib/auth.js";
import { authMiddleware, type AuthEnv } from "../middleware/auth.js";

const router = new Hono();
const authedRouter = new Hono<AuthEnv>();

// Short-lived SSE tickets (single-use, 60s expiry)
const sseTickets = new Map<string, { userId: string; createdAt: number }>();

const TICKET_TTL_MS = 60_000;

// Clean up expired tickets periodically
setInterval(() => {
  const now = Date.now();
  for (const [ticket, entry] of sseTickets) {
    if (now - entry.createdAt > TICKET_TTL_MS) {
      sseTickets.delete(ticket);
    }
  }
}, 60_000);

// Issue a short-lived ticket for SSE connection
authedRouter.post("/ticket", authMiddleware, async (c) => {
  const user = c.get("user");
  const ticket = randomBytes(32).toString("hex");
  sseTickets.set(ticket, { userId: user.id, createdAt: Date.now() });
  return c.json({ ticket });
});

router.route("/", authedRouter);

// SSE stream endpoint — uses query param ticket (preferred) or token since EventSource can't send headers
router.get("/stream", async (c) => {
  let userId: string | null = null;

  // Try ticket-based auth first
  const ticket = c.req.query("ticket");
  if (ticket) {
    const entry = sseTickets.get(ticket);
    if (entry && Date.now() - entry.createdAt <= TICKET_TTL_MS) {
      sseTickets.delete(ticket); // single-use
      userId = entry.userId;
    }
  }

  // Fall back to token-based auth
  if (!userId) {
    const token = c.req.query("token");
    const headers = new Headers(c.req.raw.headers);
    if (token && !headers.get("Authorization")) {
      headers.set("Authorization", `Bearer ${token}`);
    }

    const session = await auth.api.getSession({ headers });
    if (!session) return c.json({ error: "Unauthorized" }, 401);
    userId = session.user.id;
  }

  const streamUserId = userId;

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      controller.enqueue(
        encoder.encode(
          `event: connected\ndata: ${JSON.stringify({ userId: streamUserId })}\n\n`,
        ),
      );

      const cleanup = addSSEConnection(streamUserId, controller);

      c.req.raw.signal.addEventListener("abort", () => {
        cleanup();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
});

export default router;
