import { Hono } from "hono";
import { authMiddleware, type AuthEnv } from "../middleware/auth.js";
import { aiMiddleware, type AIEnv } from "../middleware/ai.js";
import { rateLimiter } from "../middleware/rate-limit.js";
import { prisma } from "../lib/prisma.js";
import { orchestrate } from "@brett/ai";
import { registry } from "../lib/ai-registry.js";
import type { StreamChunk } from "@brett/types";

const brettChat = new Hono<AIEnv>();

// Auth on all routes
brettChat.use("*", authMiddleware);

// ─── Helper: build SSE stream from orchestrate() ───

function buildStream(
  params: Parameters<typeof orchestrate>[0],
  sessionId: string,
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
            .catch((err: unknown) =>
              console.error("Failed to store assistant message:", err),
            );
        }
      } catch (err) {
        const errorChunk: StreamChunk = {
          type: "error",
          message:
            err instanceof Error ? err.message : "Internal server error",
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

function sseResponse(stream: ReadableStream): Response {
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

// ─── POST /:itemId — Stream chat on an item ───

brettChat.post(
  "/:itemId",
  rateLimiter(30),
  aiMiddleware,
  async (c) => {
    const user = c.get("user");
    const provider = c.get("aiProvider");
    const providerName = c.get("aiProviderName");
    const itemId = c.req.param("itemId");

    const item = await prisma.item.findFirst({
      where: { id: itemId, userId: user.id },
    });
    if (!item) return c.json({ error: "Not found" }, 404);

    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return c.json({ error: "Invalid request body" }, 400);
    }

    const { message, sessionId: existingSessionId } = body as {
      message?: unknown;
      sessionId?: unknown;
    };

    if (typeof message !== "string" || message.trim().length === 0) {
      return c.json({ error: "Message is required" }, 400);
    }
    if (message.length > 10_000) {
      return c.json({ error: "Message too long (max 10,000 characters)" }, 400);
    }

    // Create or continue session
    let session: { id: string };
    let sessionMessages: Array<{ role: string; content: string }> = [];

    if (existingSessionId && typeof existingSessionId === "string") {
      const existing = await prisma.conversationSession.findFirst({
        where: { id: existingSessionId, userId: user.id, source: "brett_thread", itemId },
        include: {
          messages: {
            orderBy: { createdAt: "asc" },
            take: 50,
            select: { role: true, content: true },
          },
        },
      });
      if (!existing) {
        return c.json({ error: "Session not found" }, 404);
      }
      session = existing;
      sessionMessages = existing.messages;
    } else {
      session = await prisma.conversationSession.create({
        data: {
          userId: user.id,
          source: "brett_thread",
          itemId,
          modelTier: "medium",
          modelUsed: "",
        },
      });
    }

    // Store user message
    await prisma.conversationMessage.create({
      data: {
        sessionId: session.id,
        role: "user",
        content: message.trim(),
      },
    });

    const input = {
      type: "brett_thread" as const,
      userId: user.id,
      message: message.trim(),
      itemId,
    };

    const { stream } = buildStream(
      { input, provider, providerName, prisma, registry, sessionId: session.id },
      session.id,
    );

    return sseResponse(stream);
  },
);

// ─── POST /event/:eventId — Stream chat on a calendar event ───

brettChat.post(
  "/event/:eventId",
  rateLimiter(30),
  aiMiddleware,
  async (c) => {
    const user = c.get("user");
    const provider = c.get("aiProvider");
    const providerName = c.get("aiProviderName");
    const eventId = c.req.param("eventId");

    const event = await prisma.calendarEvent.findFirst({
      where: { id: eventId, userId: user.id },
    });
    if (!event) return c.json({ error: "Not found" }, 404);

    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return c.json({ error: "Invalid request body" }, 400);
    }

    const { message, sessionId: existingSessionId } = body as {
      message?: unknown;
      sessionId?: unknown;
    };

    if (typeof message !== "string" || message.trim().length === 0) {
      return c.json({ error: "Message is required" }, 400);
    }
    if (message.length > 10_000) {
      return c.json({ error: "Message too long (max 10,000 characters)" }, 400);
    }

    // Create or continue session
    let session: { id: string };

    if (existingSessionId && typeof existingSessionId === "string") {
      const existing = await prisma.conversationSession.findFirst({
        where: { id: existingSessionId, userId: user.id, source: "brett_thread", calendarEventId: eventId },
        include: {
          messages: {
            orderBy: { createdAt: "asc" },
            take: 50,
            select: { role: true, content: true },
          },
        },
      });
      if (!existing) {
        return c.json({ error: "Session not found" }, 404);
      }
      session = existing;
    } else {
      session = await prisma.conversationSession.create({
        data: {
          userId: user.id,
          source: "brett_thread",
          calendarEventId: eventId,
          modelTier: "medium",
          modelUsed: "",
        },
      });
    }

    // Store user message
    await prisma.conversationMessage.create({
      data: {
        sessionId: session.id,
        role: "user",
        content: message.trim(),
      },
    });

    const input = {
      type: "brett_thread" as const,
      userId: user.id,
      message: message.trim(),
      calendarEventId: eventId,
    };

    const { stream } = buildStream(
      { input, provider, providerName, prisma, registry, sessionId: session.id },
      session.id,
    );

    return sseResponse(stream);
  },
);

// ─── GET /:itemId — Paginated chat history for an item ───

brettChat.get("/:itemId", async (c) => {
  const user = c.get("user");
  const itemId = c.req.param("itemId");

  const item = await prisma.item.findFirst({
    where: { id: itemId, userId: user.id },
  });
  if (!item) return c.json({ error: "Not found" }, 404);

  const limit = Math.min(parseInt(c.req.query("limit") || "20", 10), 50);
  const cursor = c.req.query("cursor");

  if (cursor && isNaN(new Date(cursor).getTime())) {
    return c.json({ error: "Invalid cursor" }, 400);
  }

  // Find all sessions for this item, then query messages across them
  const sessions = await prisma.conversationSession.findMany({
    where: { userId: user.id, source: "brett_thread", itemId },
    select: { id: true },
  });

  const sessionIds = sessions.map((s) => s.id);

  if (sessionIds.length === 0) {
    return c.json({ messages: [], hasMore: false, cursor: null, totalCount: 0 });
  }

  const [messages, totalCount] = await Promise.all([
    prisma.conversationMessage.findMany({
      where: {
        sessionId: { in: sessionIds },
        ...(cursor ? { createdAt: { lt: new Date(cursor) } } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: limit + 1,
    }),
    prisma.conversationMessage.count({
      where: { sessionId: { in: sessionIds } },
    }),
  ]);

  const hasMore = messages.length > limit;
  const page = hasMore ? messages.slice(0, limit) : messages;

  return c.json({
    messages: page.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      createdAt: m.createdAt.toISOString(),
    })),
    hasMore,
    cursor: hasMore ? page[page.length - 1].createdAt.toISOString() : null,
    totalCount,
  });
});

// ─── GET /event/:eventId — Paginated chat history for a calendar event ───

brettChat.get("/event/:eventId", async (c) => {
  const user = c.get("user");
  const eventId = c.req.param("eventId");

  const event = await prisma.calendarEvent.findFirst({
    where: { id: eventId, userId: user.id },
  });
  if (!event) return c.json({ error: "Not found" }, 404);

  const limit = Math.min(parseInt(c.req.query("limit") || "20", 10), 50);
  const cursor = c.req.query("cursor");

  if (cursor && isNaN(new Date(cursor).getTime())) {
    return c.json({ error: "Invalid cursor" }, 400);
  }

  const sessions = await prisma.conversationSession.findMany({
    where: { userId: user.id, source: "brett_thread", calendarEventId: eventId },
    select: { id: true },
  });

  const sessionIds = sessions.map((s) => s.id);

  if (sessionIds.length === 0) {
    return c.json({ messages: [], hasMore: false, cursor: null, totalCount: 0 });
  }

  const [messages, totalCount] = await Promise.all([
    prisma.conversationMessage.findMany({
      where: {
        sessionId: { in: sessionIds },
        ...(cursor ? { createdAt: { lt: new Date(cursor) } } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: limit + 1,
    }),
    prisma.conversationMessage.count({
      where: { sessionId: { in: sessionIds } },
    }),
  ]);

  const hasMore = messages.length > limit;
  const page = hasMore ? messages.slice(0, limit) : messages;

  return c.json({
    messages: page.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      createdAt: m.createdAt.toISOString(),
    })),
    hasMore,
    cursor: hasMore ? page[page.length - 1].createdAt.toISOString() : null,
    totalCount,
  });
});

export { brettChat };
