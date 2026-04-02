import { Hono } from "hono";
import { authMiddleware, type AuthEnv } from "../middleware/auth.js";
import { aiMiddleware, type AIEnv } from "../middleware/ai.js";
import { rateLimiter } from "../middleware/rate-limit.js";
import { prisma } from "../lib/prisma.js";
import { registry } from "../lib/ai-registry.js";
import { buildStream, sseResponse } from "../lib/ai-stream.js";
import { runExtraction } from "../lib/content-extractor.js";
import { getEmbeddingProvider } from "../lib/embedding-provider.js";
import { loadEmbeddingContext } from "../lib/embedding-context.js";

const brettChat = new Hono<AIEnv>();

// Auth on all routes
brettChat.use("*", authMiddleware);

// ─── Shared helper: paginated chat history ───

async function getPaginatedHistory(
  userId: string,
  filter: { itemId?: string; calendarEventId?: string },
  query: { limit?: string; cursor?: string },
) {
  const limit = Math.min(parseInt(query.limit || "20", 10), 50);
  const cursor = query.cursor;

  if (cursor && isNaN(new Date(cursor).getTime())) {
    return { error: "Invalid cursor" as const };
  }

  const sessions = await prisma.conversationSession.findMany({
    where: { userId, source: "brett_thread", ...filter },
    select: { id: true },
  });

  const sessionIds = sessions.map((s) => s.id);

  if (sessionIds.length === 0) {
    return { data: { messages: [], hasMore: false, cursor: null, totalCount: 0 } };
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

  return {
    data: {
      messages: page.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        createdAt: m.createdAt.toISOString(),
      })),
      hasMore,
      cursor: hasMore ? page[page.length - 1].createdAt.toISOString() : null,
      totalCount,
    },
  };
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

    // Load embedding context relevant to this message + item
    const embeddingProvider = getEmbeddingProvider();
    const embeddingContext = await loadEmbeddingContext(
      user.id,
      `${item.title} ${message.trim()}`,
      embeddingProvider,
      prisma,
      3,
    );

    const input = {
      type: "brett_thread" as const,
      userId: user.id,
      message: message.trim(),
      itemId,
      embeddingContext: embeddingContext || undefined,
    };

    const { stream } = buildStream(
      {
        input, provider, providerName, prisma, registry, sessionId: session.id,
        embeddingProvider,
        onContentCreated: (itemId, sourceUrl) => {
          runExtraction(itemId, sourceUrl, user.id).catch((err) =>
            console.error(`[brett-chat] Content extraction failed for ${itemId}:`, err));
        },
      },
      session.id,
      { memoryCtx: { userId: user.id, provider, providerName } },
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

    // Load embedding context relevant to this message + event
    const embeddingProvider = getEmbeddingProvider();
    const embeddingContext = await loadEmbeddingContext(
      user.id,
      `${event.title} ${message.trim()}`,
      embeddingProvider,
      prisma,
      3,
    );

    const input = {
      type: "brett_thread" as const,
      userId: user.id,
      message: message.trim(),
      calendarEventId: eventId,
      embeddingContext: embeddingContext || undefined,
    };

    const { stream } = buildStream(
      {
        input, provider, providerName, prisma, registry, sessionId: session.id,
        embeddingProvider,
        onContentCreated: (itemId, sourceUrl) => {
          runExtraction(itemId, sourceUrl, user.id).catch((err) =>
            console.error(`[brett-chat] Content extraction failed for ${itemId}:`, err));
        },
      },
      session.id,
      { memoryCtx: { userId: user.id, provider, providerName } },
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

  const result = await getPaginatedHistory(
    user.id,
    { itemId },
    { limit: c.req.query("limit"), cursor: c.req.query("cursor") },
  );

  if ("error" in result) return c.json({ error: result.error }, 400);
  return c.json(result.data);
});

// ─── GET /event/:eventId — Paginated chat history for a calendar event ───

brettChat.get("/event/:eventId", async (c) => {
  const user = c.get("user");
  const eventId = c.req.param("eventId");

  const event = await prisma.calendarEvent.findFirst({
    where: { id: eventId, userId: user.id },
  });
  if (!event) return c.json({ error: "Not found" }, 404);

  const result = await getPaginatedHistory(
    user.id,
    { calendarEventId: eventId },
    { limit: c.req.query("limit"), cursor: c.req.query("cursor") },
  );

  if ("error" in result) return c.json({ error: result.error }, 400);
  return c.json(result.data);
});

export { brettChat };
