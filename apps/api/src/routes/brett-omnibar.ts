import { Hono } from "hono";
import { authMiddleware, type AuthEnv } from "../middleware/auth.js";
import { aiMiddleware, type AIEnv } from "../middleware/ai.js";
import { rateLimiter } from "../middleware/rate-limit.js";
import { prisma } from "../lib/prisma.js";
import { registry } from "../lib/ai-registry.js";
import { buildStream, sseResponse } from "../lib/ai-stream.js";

const brettOmnibar = new Hono<AIEnv>();

// Auth + AI middleware on all routes
brettOmnibar.use("*", authMiddleware);

// POST / — streaming omnibar conversation
brettOmnibar.post(
  "/",
  rateLimiter(30),
  aiMiddleware,
  async (c) => {
    const user = c.get("user");
    const provider = c.get("aiProvider");
    const providerName = c.get("aiProviderName");

    // Parse and validate body
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return c.json({ error: "Invalid request body" }, 400);
    }

    const { message, sessionId, context } = body as {
      message?: unknown;
      sessionId?: unknown;
      context?: { currentView?: string; selectedItemId?: string };
    };

    if (typeof message !== "string" || message.trim().length === 0) {
      return c.json({ error: "Message is required" }, 400);
    }
    if (message.length > 10_000) {
      return c.json({ error: "Message too long (max 10,000 characters)" }, 400);
    }

    // Create or continue a ConversationSession
    let session: { id: string };
    let sessionMessages: Array<{ role: string; content: string }> = [];

    if (sessionId && typeof sessionId === "string") {
      // Continue existing session
      const existing = await prisma.conversationSession.findFirst({
        where: { id: sessionId, userId: user.id, source: "omnibar" },
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
      // Create new session
      session = await prisma.conversationSession.create({
        data: {
          userId: user.id,
          source: "omnibar",
          modelTier: "small",
          modelUsed: "",
        },
      });
    }

    // Store user message (Layer A — always persisted before streaming)
    await prisma.conversationMessage.create({
      data: {
        sessionId: session.id,
        role: "user",
        content: message.trim(),
      },
    });

    // Prepare orchestrator input
    const input = {
      type: "omnibar" as const,
      userId: user.id,
      message: message.trim(),
      sessionMessages,
      currentView: context?.currentView,
      selectedItemId: context?.selectedItemId,
    };

    // Build SSE stream
    const { stream } = buildStream(
      { input, provider, providerName, prisma, registry, sessionId: session.id },
      session.id,
      { memoryCtx: { userId: user.id, provider, providerName } },
    );

    return sseResponse(stream);
  }
);

export { brettOmnibar };
