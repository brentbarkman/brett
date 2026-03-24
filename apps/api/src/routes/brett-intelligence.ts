import { Hono } from "hono";
import { authMiddleware, type AuthEnv } from "../middleware/auth.js";
import { aiMiddleware, type AIEnv } from "../middleware/ai.js";
import { rateLimiter } from "../middleware/rate-limit.js";
import { prisma } from "../lib/prisma.js";
import { orchestrate } from "@brett/ai";
import { registry } from "../lib/ai-registry.js";
import type { StreamChunk } from "@brett/types";

const brettIntelligence = new Hono<AIEnv>();

// Auth on all routes
brettIntelligence.use("*", authMiddleware);

// ─── Helper: SSE response from orchestrate() ───

function buildStreamAndRespond(
  params: Parameters<typeof orchestrate>[0],
  sessionId: string,
  opts?: { onDone?: (content: string) => void },
): Response {
  const encoder = new TextEncoder();
  let assistantContent = "";

  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of orchestrate(params)) {
          if (chunk.type === "text") {
            assistantContent += chunk.content;
          }
          const data = `event: chunk\ndata: ${JSON.stringify(chunk)}\n\n`;
          controller.enqueue(encoder.encode(data));
        }
        controller.close();

        // Fire-and-forget: store assistant response + callback
        if (assistantContent.trim()) {
          prisma.conversationMessage
            .create({
              data: {
                sessionId,
                role: "assistant",
                content: assistantContent,
              },
            })
            .catch((err: unknown) =>
              console.error("Failed to store assistant message:", err),
            );

          if (opts?.onDone) {
            try {
              opts.onDone(assistantContent);
            } catch (err) {
              console.error("onDone callback failed:", err);
            }
          }
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

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

// ─── GET /briefing — Get today's cached briefing ───

brettIntelligence.get("/briefing", async (c) => {
  const user = c.get("user");

  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const session = await prisma.conversationSession.findFirst({
    where: {
      userId: user.id,
      source: "briefing",
      createdAt: { gte: startOfDay },
    },
    orderBy: { createdAt: "desc" },
    include: {
      messages: {
        where: { role: "assistant" },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { content: true, createdAt: true },
      },
    },
  });

  if (!session || session.messages.length === 0) {
    return c.json({ briefing: null });
  }

  return c.json({
    briefing: {
      sessionId: session.id,
      content: session.messages[0].content,
      generatedAt: session.messages[0].createdAt.toISOString(),
    },
  });
});

// ─── POST /briefing/generate — Force-regenerate briefing (streaming) ───

brettIntelligence.post(
  "/briefing/generate",
  rateLimiter(10),
  aiMiddleware,
  async (c) => {
    const user = c.get("user");
    const provider = c.get("aiProvider");
    const providerName = c.get("aiProviderName");

    const session = await prisma.conversationSession.create({
      data: {
        userId: user.id,
        source: "briefing",
        modelTier: "medium",
        modelUsed: "",
      },
    });

    const input = {
      type: "briefing" as const,
      userId: user.id,
    };

    return buildStreamAndRespond(
      { input, provider, providerName, prisma, registry, sessionId: session.id },
      session.id,
    );
  },
);

// ─── POST /take/:itemId — Generate Brett's Take on item (streaming) ───

brettIntelligence.post(
  "/take/:itemId",
  rateLimiter(20),
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

    const session = await prisma.conversationSession.create({
      data: {
        userId: user.id,
        source: "bretts_take",
        itemId,
        modelTier: "medium",
        modelUsed: "",
      },
    });

    const input = {
      type: "bretts_take" as const,
      userId: user.id,
      itemId,
    };

    return buildStreamAndRespond(
      { input, provider, providerName, prisma, registry, sessionId: session.id },
      session.id,
      {
        onDone: (content) => {
          // Store result in item.brettObservation
          prisma.item
            .update({
              where: { id: itemId },
              data: {
                brettObservation: content,
                brettTakeGeneratedAt: new Date(),
              },
            })
            .catch((err: unknown) =>
              console.error("Failed to update brettObservation:", err),
            );
        },
      },
    );
  },
);

// ─── POST /take/event/:eventId — Brett's Take on calendar event (streaming) ───

brettIntelligence.post(
  "/take/event/:eventId",
  rateLimiter(20),
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

    const session = await prisma.conversationSession.create({
      data: {
        userId: user.id,
        source: "bretts_take",
        calendarEventId: eventId,
        modelTier: "medium",
        modelUsed: "",
      },
    });

    const input = {
      type: "bretts_take" as const,
      userId: user.id,
      calendarEventId: eventId,
    };

    return buildStreamAndRespond(
      { input, provider, providerName, prisma, registry, sessionId: session.id },
      session.id,
    );
  },
);

// ─── GET /up-next — Next event + cached take ───

brettIntelligence.get("/up-next", async (c) => {
  const user = c.get("user");
  const now = new Date();

  const nextEvent = await prisma.calendarEvent.findFirst({
    where: {
      userId: user.id,
      startTime: { gt: now },
      status: "confirmed",
    },
    orderBy: { startTime: "asc" },
    select: {
      id: true,
      title: true,
      startTime: true,
      endTime: true,
      location: true,
      attendees: true,
      meetingLink: true,
      isAllDay: true,
    },
  });

  if (!nextEvent) {
    return c.json({ event: null });
  }

  // Check for a cached Brett's Take session for this event
  const takeSession = await prisma.conversationSession.findFirst({
    where: {
      userId: user.id,
      source: "bretts_take",
      calendarEventId: nextEvent.id,
    },
    orderBy: { createdAt: "desc" },
    include: {
      messages: {
        where: { role: "assistant" },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { content: true, createdAt: true },
      },
    },
  });

  const brettTake = takeSession?.messages[0] ?? null;

  return c.json({
    event: {
      id: nextEvent.id,
      title: nextEvent.title,
      startTime: nextEvent.startTime.toISOString(),
      endTime: nextEvent.endTime.toISOString(),
      location: nextEvent.location,
      attendees: nextEvent.attendees,
      meetingLink: nextEvent.meetingLink,
      isAllDay: nextEvent.isAllDay,
      brettObservation: brettTake?.content ?? null,
      brettTakeGeneratedAt: brettTake?.createdAt.toISOString() ?? null,
    },
  });
});

export { brettIntelligence };
