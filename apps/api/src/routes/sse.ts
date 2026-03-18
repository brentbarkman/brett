import { Hono } from "hono";
import { addSSEConnection } from "../lib/sse.js";
import { auth } from "../lib/auth.js";

const router = new Hono();

// SSE stream endpoint — uses query param token since EventSource can't send headers
router.get("/stream", async (c) => {
  const token = c.req.query("token");
  const headers = new Headers(c.req.raw.headers);
  if (token && !headers.get("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const session = await auth.api.getSession({ headers });
  if (!session) return c.json({ error: "Unauthorized" }, 401);
  const user = session.user;

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      controller.enqueue(
        encoder.encode(
          `event: connected\ndata: ${JSON.stringify({ userId: user.id })}\n\n`,
        ),
      );

      const cleanup = addSSEConnection(user.id, controller);

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
