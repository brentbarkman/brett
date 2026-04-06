import { Hono } from "hono";
import { authMiddleware, type AuthEnv } from "../middleware/auth.js";
import { aiMiddleware, type AIEnv } from "../middleware/ai.js";
import { rateLimiter } from "../middleware/rate-limit.js";
import { prisma } from "../lib/prisma.js";
import { registry } from "../lib/ai-registry.js";
import { buildStream, sseResponse } from "../lib/ai-stream.js";
import { getUserDayBounds } from "@brett/business";
import { getEmbeddingProvider } from "../lib/embedding-provider.js";
import { loadEmbeddingContext } from "../lib/embedding-context.js";

const DEFAULT_TIMEZONE = "America/Los_Angeles";

async function getUserSettings(userId: string): Promise<{ timezone: string; assistantName: string }> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { timezone: true, assistantName: true },
  });
  return {
    timezone: user?.timezone ?? DEFAULT_TIMEZONE,
    assistantName: user?.assistantName ?? "Brett",
  };
}

const brettIntelligence = new Hono<AIEnv>();

// Auth on all routes
brettIntelligence.use("*", authMiddleware);

// ─── GET /briefing — Get today's cached briefing ───

brettIntelligence.get("/briefing", rateLimiter(60), async (c) => {
  const user = c.get("user");

  const { timezone } = await getUserSettings(user.id);
  const { startOfDay, endOfDay } = getUserDayBounds(timezone);

  const session = await prisma.conversationSession.findFirst({
    where: {
      userId: user.id,
      source: "briefing",
      createdAt: { gte: startOfDay, lt: endOfDay },
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

  const content = session.messages[0].content;
  if (!content || !content.trim()) {
    return c.json({ briefing: null });
  }

  return c.json({
    briefing: {
      sessionId: session.id,
      content,
      generatedAt: session.messages[0].createdAt.toISOString(),
    },
  });
});

// ─── GET /briefing/summary — Lightweight counts, no AI required ───

brettIntelligence.get("/briefing/summary", rateLimiter(30), async (c) => {
  const user = c.get("user");

  const { timezone } = await getUserSettings(user.id);
  const { startOfDay, endOfDay } = getUserDayBounds(timezone);

  // Only count events from visible calendars
  const visibleCalendars = await prisma.calendarList.findMany({
    where: { googleAccount: { userId: user.id }, isVisible: true },
    select: { id: true },
  });
  const visibleCalendarIds = visibleCalendars.map((c) => c.id);

  const [overdueCount, dueTodayCount, eventCount, overdueItems] =
    await Promise.all([
      prisma.item.count({
        where: {
          userId: user.id,
          type: "task",
          status: "active",
          dueDate: { lt: startOfDay },
        },
      }),
      prisma.item.count({
        where: {
          userId: user.id,
          type: "task",
          status: "active",
          dueDate: { gte: startOfDay, lt: endOfDay },
        },
      }),
      prisma.calendarEvent.count({
        where: {
          userId: user.id,
          calendarListId: { in: visibleCalendarIds },
          startTime: { gte: startOfDay, lt: endOfDay },
          status: "confirmed",
        },
      }),
      prisma.item.findMany({
        where: {
          userId: user.id,
          type: "task",
          status: "active",
          dueDate: { lt: startOfDay },
        },
        select: { title: true, dueDate: true },
        orderBy: { dueDate: "asc" },
        take: 3,
      }),
    ]);

  return c.json({
    overdueTasks: overdueCount,
    dueTodayTasks: dueTodayCount,
    todayEvents: eventCount,
    overdueItems: overdueItems.map((i) => ({
      title: i.title,
      dueDate: i.dueDate!.toISOString().split("T")[0],
    })),
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

    const { timezone, assistantName } = await getUserSettings(user.id);

    // Load embedding context for the briefing — search for recent activity patterns
    const embeddingProvider = getEmbeddingProvider();
    const embeddingContext = await loadEmbeddingContext(
      user.id,
      "daily briefing tasks calendar meetings priorities",
      embeddingProvider,
      prisma,
      3,
    );

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
      assistantName,
      timezone,
      embeddingContext: embeddingContext || undefined,
    };

    const { stream } = buildStream(
      { input, provider, providerName, prisma, registry, sessionId: session.id, embeddingProvider },
      session.id,
    );

    return sseResponse(stream);
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

    // Load user settings and embedding context in parallel
    const embeddingProvider = getEmbeddingProvider();
    const [userSettings, embeddingContext] = await Promise.all([
      getUserSettings(user.id),
      loadEmbeddingContext(
        user.id,
        event.title,
        embeddingProvider,
        prisma,
        3,
      ),
    ]);

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
      assistantName: userSettings.assistantName,
      calendarEventId: eventId,
      embeddingContext: embeddingContext || undefined,
    };

    const { stream } = buildStream(
      { input, provider, providerName, prisma, registry, sessionId: session.id, embeddingProvider },
      session.id,
      {
        onDone: (content) => {
          prisma.calendarEvent
            .update({
              where: { id: eventId },
              data: {
                brettObservation: content,
                brettObservationAt: new Date(),
              },
            })
            .catch((err: unknown) =>
              console.error("Failed to update event brettObservation:", err),
            );
        },
      },
    );

    return sseResponse(stream);
  },
);

// ─── GET /up-next — Next event + cached take ───

brettIntelligence.get("/up-next", rateLimiter(60), async (c) => {
  const user = c.get("user");
  const now = new Date();

  const nextEvent = await prisma.calendarEvent.findFirst({
    where: {
      userId: user.id,
      startTime: { gt: now },
      status: "confirmed",
      myResponseStatus: { not: "observer" },
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
