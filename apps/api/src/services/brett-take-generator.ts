import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { decryptToken } from "../lib/encryption.js";
import { getProvider, orchestrate } from "@brett/ai";
import { registry } from "../lib/ai-registry.js";
import type { AIProviderName } from "@brett/types";

const MIN_DESCRIPTION_LENGTH = 50;
const MAX_EVENTS_PER_CYCLE = 10;

interface EventForQualification {
  id: string;
  description: string | null;
  recurringEventId: string | null;
  brettObservation: string | null;
  brettObservationAt: Date | null;
  updatedAt: Date;
}

/**
 * Does this event have enough context to merit a Brett's Take?
 * @param hasPriorTranscript - whether a prior occurrence has a MeetingNote transcript
 */
export function qualifiesForTake(
  event: EventForQualification,
  hasPriorTranscript: boolean,
): boolean {
  if (event.description && event.description.length > MIN_DESCRIPTION_LENGTH) {
    return true;
  }
  if (event.recurringEventId && hasPriorTranscript) {
    return true;
  }
  return false;
}

/**
 * Does this event need (re)generation of its Take?
 */
export function needsGeneration(event: EventForQualification): boolean {
  if (!event.brettObservation) return true;
  if (!event.brettObservationAt) return true;
  return event.brettObservationAt < event.updatedAt;
}

/**
 * Generate Brett's Takes for qualifying upcoming calendar events.
 * Called after calendar sync completes. Fire-and-forget.
 *
 * Budget: at most MAX_EVENTS_PER_CYCLE events per call, prioritized by startTime.
 */
export async function generatePendingTakes(userId: string): Promise<void> {
  // 1. Check user has active AI config
  const config = await prisma.userAIConfig.findFirst({
    where: { userId, isActive: true, isValid: true },
  });
  if (!config) return; // No AI provider — skip silently

  // 2. Fetch upcoming events in next 48 hours
  const now = new Date();
  const in48h = new Date(now.getTime() + 48 * 60 * 60 * 1000);

  const events = await prisma.calendarEvent.findMany({
    where: {
      userId,
      startTime: { gte: now, lte: in48h },
      status: { not: "cancelled" },
    },
    orderBy: { startTime: "asc" },
    select: {
      id: true,
      description: true,
      recurringEventId: true,
      brettObservation: true,
      brettObservationAt: true,
      updatedAt: true,
    },
  });

  // 3. For recurring events, batch-check which have prior transcripts
  const recurringIds = events
    .filter((e) => e.recurringEventId)
    .map((e) => e.recurringEventId!);

  const recurringWithTranscripts = new Set<string>();
  if (recurringIds.length > 0) {
    const priorWithTranscripts = await prisma.meetingNote.findMany({
      where: {
        userId,
        calendarEvent: {
          recurringEventId: { in: recurringIds },
          startTime: { lt: now },
        },
        transcript: { not: Prisma.DbNull },
      },
      select: {
        calendarEvent: {
          select: { recurringEventId: true },
        },
      },
      distinct: ["calendarEventId"],
    });
    for (const mn of priorWithTranscripts) {
      if (mn.calendarEvent?.recurringEventId) {
        recurringWithTranscripts.add(mn.calendarEvent.recurringEventId);
      }
    }
  }

  // 4. Filter to qualifying events that need generation
  const candidates = events.filter((e) => {
    const hasPriorTranscript = e.recurringEventId
      ? recurringWithTranscripts.has(e.recurringEventId)
      : false;
    return qualifiesForTake(e, hasPriorTranscript) && needsGeneration(e);
  });

  // 5. Cap at budget
  const toGenerate = candidates.slice(0, MAX_EVENTS_PER_CYCLE);

  if (toGenerate.length === 0) return;

  // 6. Set up AI provider
  let apiKey: string;
  try {
    apiKey = decryptToken(config.encryptedKey);
  } catch {
    return; // Key decryption failed — skip silently
  }
  const provider = getProvider(config.provider as AIProviderName, apiKey);
  const providerName = config.provider as AIProviderName;

  // 7. Generate Takes sequentially (avoid parallel to respect rate limits)
  for (const event of toGenerate) {
    try {
      await generateSingleTake(userId, event.id, provider, providerName);
    } catch (err) {
      console.error(
        `[brett-take-generator] Failed for event ${event.id}:`,
        err,
      );
      // Continue with next event — don't let one failure block the rest
    }
  }
}

async function generateSingleTake(
  userId: string,
  eventId: string,
  provider: ReturnType<typeof getProvider>,
  providerName: AIProviderName,
): Promise<void> {
  const session = await prisma.conversationSession.create({
    data: {
      userId,
      source: "bretts_take",
      calendarEventId: eventId,
      modelTier: "small",
      modelUsed: "",
    },
  });

  const input = {
    type: "bretts_take" as const,
    userId,
    calendarEventId: eventId,
  };

  let content = "";
  let model = "";

  for await (const chunk of orchestrate({
    input,
    provider,
    providerName,
    prisma,
    registry,
    sessionId: session.id,
  })) {
    if (chunk.type === "text") {
      content += chunk.content;
    }
    if (chunk.type === "done" && chunk.model) {
      model = chunk.model;
    }
    if (chunk.type === "error") {
      console.error(
        `[brett-take-generator] Orchestrator error for event ${eventId}:`,
        chunk.message,
      );
      return;
    }
  }

  // Store result
  if (content.trim()) {
    await Promise.all([
      prisma.calendarEvent.update({
        where: { id: eventId },
        data: {
          brettObservation: content,
          brettObservationAt: new Date(),
        },
      }),
      prisma.conversationSession.update({
        where: { id: session.id },
        data: { modelUsed: model },
      }),
      prisma.conversationMessage.create({
        data: {
          sessionId: session.id,
          role: "assistant",
          content,
        },
      }),
    ]);
  }
}
