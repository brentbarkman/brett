import { Prisma } from "@brett/api-core";
import { prisma } from "../lib/prisma.js";
import { decryptToken } from "../lib/encryption.js";
import { getProvider, orchestrate } from "@brett/ai";
import { registry } from "../lib/ai-registry.js";
import { getEmbeddingProvider } from "../lib/embedding-provider.js";
import { loadEmbeddingContext } from "../lib/embedding-context.js";
import type { AIProviderName } from "@brett/types";

const MIN_DESCRIPTION_LENGTH = 50;
const MAX_EVENTS_PER_CYCLE = 10;
const GENERATION_COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes

// Concurrency guard — prevent duplicate generation for the same user
const inFlightGenerations = new Set<string>();
// Per-user cooldown to prevent webhook storms from burning tokens
const lastGenerationTime = new Map<string, number>();

interface EventForQualification {
  id: string;
  title: string;
  description: string | null;
  recurringEventId: string | null;
  brettObservation: string | null;
  brettObservationAt: Date | null;
  brettObservationHash: string | null;
  startTime: Date;
  location: string | null;
  attendeesJson: string | null;
}

/**
 * Does this event have enough context to merit a Brett's Take?
 * @param hasPriorSummary - whether a prior occurrence has a MeetingNote with a summary
 */
export function qualifiesForTake(
  event: EventForQualification,
  hasPriorSummary: boolean,
): boolean {
  if (event.description && event.description.length > MIN_DESCRIPTION_LENGTH) {
    return true;
  }
  if (event.recurringEventId && hasPriorSummary) {
    return true;
  }
  return false;
}

/**
 * Compute a simple hash of the event fields that matter for Take generation.
 * If these haven't changed, the Take is still fresh.
 * Includes hasPriorSummary so Takes regenerate when a new meeting summary appears.
 */
export function contentHash(
  event: Pick<EventForQualification, "description" | "title" | "startTime" | "location" | "attendeesJson">,
  hasPriorSummary = false,
): string {
  const parts = [
    event.title ?? "",
    event.description ?? "",
    event.startTime?.toISOString() ?? "",
    event.location ?? "",
    event.attendeesJson ?? "",
    hasPriorSummary ? "has_summary" : "",
  ];
  // Simple string hash — not crypto, just change detection
  let hash = 0;
  const str = parts.join("|");
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return hash.toString(36);
}

/**
 * Does this event need (re)generation of its Take?
 * Uses a content hash to avoid regenerating when only sync metadata changed.
 */
export function needsGeneration(event: EventForQualification, hasPriorSummary = false): boolean {
  if (!event.brettObservation) return true;
  if (!event.brettObservationAt) return true;
  // Compare content hash to detect meaningful changes
  const currentHash = contentHash(event, hasPriorSummary);
  return event.brettObservationHash !== currentHash;
}

/**
 * Generate Brett's Takes for qualifying upcoming calendar events.
 * Called after calendar sync completes. Fire-and-forget.
 *
 * Budget: at most MAX_EVENTS_PER_CYCLE events per call, prioritized by startTime.
 */
export async function generatePendingTakes(userId: string): Promise<void> {
  // Concurrency guard — prevent duplicate generation for same user
  if (inFlightGenerations.has(userId)) return;

  // Per-user cooldown — prevent webhook storms from burning tokens
  const lastRun = lastGenerationTime.get(userId);
  if (lastRun && Date.now() - lastRun < GENERATION_COOLDOWN_MS) return;

  inFlightGenerations.add(userId);
  lastGenerationTime.set(userId, Date.now());

  try {
    // 1. Check user has active AI config and fetch user settings
    const [config, userRecord] = await Promise.all([
      prisma.userAIConfig.findFirst({
        where: { userId, isActive: true, isValid: true },
      }),
      prisma.user.findUnique({
        where: { id: userId },
        select: { assistantName: true },
      }),
    ]);
    if (!config) return; // No AI provider — skip silently

    const assistantName = userRecord?.assistantName ?? "Brett";

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
        title: true,
        description: true,
        recurringEventId: true,
        brettObservation: true,
        brettObservationAt: true,
        brettObservationHash: true,
        startTime: true,
        location: true,
        attendees: true,
      },
    });

    // Map attendees JSON to string for hashing
    const eventsForQualification = events.map((e) => ({
      ...e,
      attendeesJson: e.attendees ? JSON.stringify(e.attendees) : null,
    }));

    // 3. For recurring events, batch-check which have prior summaries
    const recurringIds = [...new Set(
      eventsForQualification
        .filter((e) => e.recurringEventId)
        .map((e) => e.recurringEventId!),
    )];

    const recurringWithSummaries = new Set<string>();
    if (recurringIds.length > 0) {
      const priorWithSummaries = await prisma.meetingNote.findMany({
        where: {
          userId,
          calendarEvent: {
            recurringEventId: { in: recurringIds },
            startTime: { lt: now },
          },
          summary: { not: null },
        },
        select: {
          calendarEvent: {
            select: { recurringEventId: true },
          },
        },
        distinct: ["calendarEventId"],
      });
      for (const mn of priorWithSummaries) {
        if (mn.calendarEvent?.recurringEventId) {
          recurringWithSummaries.add(mn.calendarEvent.recurringEventId);
        }
      }
    }

    // 4. Filter to qualifying events that need generation
    const candidates = eventsForQualification
      .map((e) => {
        const hasPriorSummary = e.recurringEventId
          ? recurringWithSummaries.has(e.recurringEventId)
          : false;
        return { event: e, hasPriorSummary };
      })
      .filter(({ event, hasPriorSummary }) =>
        qualifiesForTake(event, hasPriorSummary) && needsGeneration(event, hasPriorSummary),
      );

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
    for (const { event, hasPriorSummary } of toGenerate) {
      try {
        const hash = contentHash(event, hasPriorSummary);
        await generateSingleTake(userId, event.id, event.title, hash, provider, providerName, assistantName);
      } catch (err) {
        console.error(
          `[brett-take-generator] Failed for event ${event.id}:`,
          err,
        );
        // Continue with next event — don't let one failure block the rest
      }
    }
  } finally {
    inFlightGenerations.delete(userId);
  }
}

async function generateSingleTake(
  userId: string,
  eventId: string,
  eventTitle: string,
  hash: string,
  provider: ReturnType<typeof getProvider>,
  providerName: AIProviderName,
  assistantName: string,
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

  // Load embedding context so Takes can reference related tasks, meetings, etc.
  const embeddingProvider = getEmbeddingProvider();
  const embeddingContext = await loadEmbeddingContext(
    userId, eventTitle, embeddingProvider, prisma, 3,
  ).catch(() => "");

  const input = {
    type: "bretts_take" as const,
    userId,
    assistantName,
    calendarEventId: eventId,
    embeddingContext: embeddingContext || undefined,
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
      // Mark session as failed so it's not orphaned
      await prisma.conversationSession.update({
        where: { id: session.id },
        data: { modelUsed: "error:orchestrator-error" },
      }).catch(() => {});
      return;
    }
  }

  // Store result atomically
  if (content.trim()) {
    await prisma.$transaction([
      prisma.calendarEvent.update({
        where: { id: eventId },
        data: {
          brettObservation: content,
          brettObservationAt: new Date(),
          brettObservationHash: hash,
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
  } else {
    // No content produced — mark session as failed
    await prisma.conversationSession.update({
      where: { id: session.id },
      data: { modelUsed: model || "error:empty-output" },
    }).catch(() => {});
  }
}
