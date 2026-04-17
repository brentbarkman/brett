import type { ExtendedPrismaClient } from "@brett/api-core";
import type { ModelTier } from "@brett/types";
import type { Message } from "../providers/types.js";
import {
  getSystemPrompt,
  getBriefingPrompt,
  getBrettsTakePrompt,
  SCOUT_CREATION_PROMPT,
} from "./system-prompts.js";
import { AI_CONFIG } from "../config.js";
import { getUserDayBounds } from "@brett/business";
import { resolveTempUnit, convertTemp } from "@brett/utils";
import { getCachedUserProfile, formatProfileForPrompt } from "../memory/user-profile.js";

// ─── Input types ───

interface OmnibarContext {
  type: "omnibar";
  userId: string;
  message: string;
  sessionMessages?: Array<{ role: string; content: string }>;
  currentView?: string;
  selectedItemId?: string;
  intent?: string;
  /** Pre-loaded embedding search results for context enrichment */
  embeddingContext?: string;
  assistantName?: string;
}

interface BrettThreadContext {
  type: "brett_thread";
  userId: string;
  message: string;
  itemId?: string;
  calendarEventId?: string;
  /** Pre-loaded embedding search results for context enrichment */
  embeddingContext?: string;
  assistantName?: string;
}

interface BriefingContext {
  type: "briefing";
  userId: string;
  timezone: string;
  /** Pre-loaded embedding search results for context enrichment */
  embeddingContext?: string;
  assistantName?: string;
}

interface BrettsTakeContext {
  type: "bretts_take";
  userId: string;
  itemId?: string;
  calendarEventId?: string;
  /** Pre-loaded embedding search results for context enrichment */
  embeddingContext?: string;
  assistantName?: string;
}

export type AssemblerInput =
  | OmnibarContext
  | BrettThreadContext
  | BriefingContext
  | BrettsTakeContext;

export type ToolMode = "all" | "contextual" | "none";

export interface AssembledContext {
  system: string;
  messages: Message[];
  modelTier: ModelTier;
  /** Controls which tools the orchestrator sends to the LLM.
   *  - "contextual": filter tools by user message (default for omnibar)
   *  - "all": send all registered tools
   *  - "none": pure text generation, no tools (briefing, bretts_take)
   */
  toolMode: ToolMode;
  maxTokens?: number;
}

// ─── Constants ───

const VALID_VIEWS = ["today", "upcoming", "inbox", "settings", "calendar", "scouts"];
const CUID_PATTERN = /^[a-z0-9]{20,30}$/;
const MAX_FACTS = AI_CONFIG.context.maxFacts;
const VALID_TIMEZONES = new Set(Intl.supportedValuesOf("timeZone"));

// ─── Helpers ───

function currentDateLine(): string {
  return `\nCurrent date: ${new Date().toISOString().split("T")[0]}`;
}

function formatFacts(
  facts: Array<{ category: string; key: string; value: string }>
): string {
  if (facts.length === 0) return "";
  const lines = facts.map((f) => `- [${f.category}] ${f.key}: ${escapeUserContent(f.value)}`);
  return `\n\nKnown facts about the user:\n<user_data label="facts">\n${lines.join("\n")}\n</user_data>`;
}

function formatEmbeddingContext(embeddingContext?: string): string {
  if (!embeddingContext) return "";
  return `\n\nRelevant context from past conversations and stored content:\n${wrapUserData("embedding_context", embeddingContext)}`;
}

async function loadUserProfile(
  prisma: ExtendedPrismaClient,
  userId: string,
): Promise<string> {
  const profile = await getCachedUserProfile(userId, prisma);
  if (!profile) return "";
  const formatted = formatProfileForPrompt(profile);
  return `\n\nUser profile:\n${wrapUserData("user_profile", formatted)}`;
}

async function loadUserFacts(
  prisma: ExtendedPrismaClient,
  userId: string
): Promise<Array<{ category: string; key: string; value: string }>> {
  const facts = await prisma.userFact.findMany({
    where: { userId, validUntil: null }, // Only current facts
    orderBy: { createdAt: "desc" },
    take: MAX_FACTS,
    select: { category: true, key: true, value: true },
  });
  return facts;
}

function isValidView(view: string): boolean {
  if (VALID_VIEWS.includes(view)) return true;
  if (view.startsWith("list:")) {
    const listId = view.slice(5);
    return CUID_PATTERN.test(listId);
  }
  return false;
}

function escapeUserContent(content: string): string {
  // Prevent tag breakout attacks: user content containing </user_data> could
  // escape the data block and inject instructions into the trusted prompt space.
  // Replace closing tags with an escaped version the LLM won't interpret as a boundary.
  return content.replace(/<\/user_data>/gi, "&lt;/user_data&gt;");
}

function wrapUserData(label: string, content: string): string {
  // Sanitize label to prevent attribute injection (should always be hardcoded,
  // but defense-in-depth in case it's ever called with dynamic values)
  const safeLabel = label.replace(/[^a-z0-9_-]/gi, "");
  return `<user_data label="${safeLabel}">\n${escapeUserContent(content)}\n</user_data>`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function formatAttendees(attendees: any): string {
  if (!attendees) return "None";
  if (!Array.isArray(attendees)) return "None";
  return attendees
    .map((a: { displayName?: string; email?: string }) => {
      if (a.displayName && a.email) return `${a.displayName} (${a.email})`;
      return a.displayName || a.email || "Unknown";
    })
    .join(", ");
}

function formatItem(item: {
  title: string;
  type: string;
  status: string;
  notes?: string | null;
  dueDate?: Date | null;
  dueDatePrecision?: string | null;
  brettObservation?: string | null;
  description?: string | null;
}): string {
  const parts = [
    `Title: ${item.title}`,
    `Type: ${item.type}`,
    `Status: ${item.status}`,
  ];
  if (item.dueDate) {
    parts.push(
      `Due: ${item.dueDate.toISOString().split("T")[0]}${item.dueDatePrecision ? ` (${item.dueDatePrecision})` : ""}`
    );
  }
  if (item.description) parts.push(`Description: ${item.description}`);
  if (item.notes) parts.push(`Notes: ${item.notes}`);
  if (item.brettObservation)
    parts.push(`Previous observation: ${item.brettObservation}`);
  return parts.join("\n");
}

function formatCalendarEvent(event: {
  title: string;
  startTime: Date;
  endTime: Date;
  description?: string | null;
  location?: string | null;
  myResponseStatus: string;
  attendees?: unknown;
  meetingLink?: string | null;
}): string {
  const parts = [
    `Title: ${event.title}`,
    `Start: ${event.startTime.toISOString()}`,
    `End: ${event.endTime.toISOString()}`,
    `My RSVP: ${event.myResponseStatus}`,
    `Attendees: ${formatAttendees(event.attendees)}`,
  ];
  if (event.location) parts.push(`Location: ${event.location}`);
  if (event.description) parts.push(`Description: ${event.description}`);
  if (event.meetingLink) parts.push(`Meeting link: ${event.meetingLink}`);
  return parts.join("\n");
}

// ─── Assemblers per context type ───

async function assembleOmnibar(
  input: OmnibarContext,
  prisma: ExtendedPrismaClient
): Promise<AssembledContext> {
  const [facts, profileBlock] = await Promise.all([
    loadUserFacts(prisma, input.userId),
    loadUserProfile(prisma, input.userId),
  ]);

  // Only inject scout creation guidance when the user is on the scouts page or explicitly
  // intends to create one. Saves ~400 tokens on every other request.
  const isScoutContext = input.currentView === "scouts" || input.intent === "create_scout";
  const scoutBlock = isScoutContext ? SCOUT_CREATION_PROMPT : "";

  const system =
    getSystemPrompt(input.assistantName ?? "Brett") + scoutBlock + formatFacts(facts) + profileBlock + formatEmbeddingContext(input.embeddingContext) + currentDateLine();

  const messages: Message[] = [];

  // Replay session history
  if (input.sessionMessages) {
    for (const msg of input.sessionMessages) {
      if (msg.role === "user" || msg.role === "assistant") {
        messages.push({ role: msg.role, content: msg.content });
      }
    }
  }

  // Add current view context if valid
  let viewContext = "";
  if (input.currentView) {
    if (isValidView(input.currentView)) {
      viewContext = `[User is currently viewing: ${input.currentView}]`;
    }
    // Invalid views are silently ignored (security: don't let injected view names through)
  }

  // Add intent signal if present (e.g., user selected "Monitor" action)
  const validIntents = new Set(["create_scout"]);
  let intentContext = "";
  if (input.intent && validIntents.has(input.intent)) {
    intentContext = `[User intent: ${input.intent}]`;
  }

  const contextParts = [viewContext, intentContext].filter(Boolean).join("\n");
  const userContent = contextParts
    ? `${contextParts}\n\n${input.message}`
    : input.message;

  messages.push({ role: "user", content: userContent });

  // Complex requests start on medium model for better reasoning.
  // Simple requests stay on small for speed/cost.
  // Multi-turn sessions escalate to medium — follow-up messages typically
  // need more context reasoning than standalone queries.
  const lower = input.message.toLowerCase();
  const actionWords = lower.match(/\b(create|make|move|add|put|delete|remove|archive|update|change|snooze|complete|done|mark)\b/g);
  const hasSessionHistory = (input.sessionMessages?.length ?? 0) >= 2;
  const isComplex = lower.length > 80 || (actionWords && actionWords.length >= 2) || hasSessionHistory;
  const tier = isComplex ? "medium" : "small";

  return { system, messages, modelTier: tier, toolMode: "contextual" };
}

async function assembleBrettThread(
  input: BrettThreadContext,
  prisma: ExtendedPrismaClient
): Promise<AssembledContext> {
  const [facts, profileBlock] = await Promise.all([
    loadUserFacts(prisma, input.userId),
    loadUserProfile(prisma, input.userId),
  ]);

  let itemContext = "";

  // Load item details if provided
  if (input.itemId) {
    const item = await prisma.item.findFirst({
      where: { id: input.itemId, userId: input.userId },
      select: {
        title: true,
        type: true,
        status: true,
        notes: true,
        dueDate: true,
        dueDatePrecision: true,
        brettObservation: true,
        description: true,
      },
    });
    if (item) {
      itemContext = `\n\nItem context:\n${wrapUserData("item", formatItem(item))}`;
    }
  }

  // Load calendar event details if provided
  if (input.calendarEventId) {
    const event = await prisma.calendarEvent.findFirst({
      where: { id: input.calendarEventId, userId: input.userId },
      select: {
        title: true,
        startTime: true,
        endTime: true,
        description: true,
        location: true,
        myResponseStatus: true,
        attendees: true,
        meetingLink: true,
      },
    });
    if (event) {
      itemContext += `\n\nCalendar event context:\n${wrapUserData("calendar_event", formatCalendarEvent(event))}`;
    }
  }

  const system =
    getSystemPrompt(input.assistantName ?? "Brett") +
    formatFacts(facts) +
    profileBlock +
    itemContext +
    formatEmbeddingContext(input.embeddingContext) +
    currentDateLine();

  // Item context + user facts provide sufficient memory for Brett threads.
  // Past session history was ~2,000-3,000 tokens of low-value back-and-forth.
  const messages: Message[] = [
    { role: "user", content: input.message },
  ];

  return { system, messages, modelTier: "medium", toolMode: "contextual" };
}

async function assembleBriefing(
  input: BriefingContext,
  prisma: ExtendedPrismaClient
): Promise<AssembledContext> {
  // Briefing needs minimal facts — just enough for tone/context, not the full 20
  const [allFacts, profileBlock] = await Promise.all([
    loadUserFacts(prisma, input.userId),
    loadUserProfile(prisma, input.userId),
  ]);
  const facts = allFacts.slice(0, 5);

  // Validate timezone at point-of-use (defense-in-depth)
  const timezone = input.timezone;
  const now = new Date();
  let currentDate: string;
  try {
    currentDate = now.toLocaleDateString("en-CA", { timeZone: timezone });
  } catch {
    currentDate = now.toLocaleDateString("en-CA", { timeZone: "UTC" });
  }

  // Validate timezone for system prompt (defense-in-depth)
  const safeTimezone = VALID_TIMEZONES.has(timezone) ? timezone : "UTC";

  const system =
    getBriefingPrompt(input.assistantName ?? "Brett") +
    formatFacts(facts) +
    profileBlock +
    formatEmbeddingContext(input.embeddingContext) +
    `\nCurrent date: ${currentDate}` +
    `\nCurrent timezone: ${safeTimezone}`;

  const { startOfDay, endOfDay } = getUserDayBounds(timezone, now);

  // Only include events from visible calendars
  const visibleCalendars = await prisma.calendarList.findMany({
    where: { googleAccount: { userId: input.userId }, isVisible: true },
    select: { id: true },
  });
  const visibleCalendarIds = visibleCalendars.map((c) => c.id);

  const [overdueTasksRaw, overdueCount, dueTodayTasks, todayEvents, weatherData] = await Promise.all([
    prisma.item.findMany({
      where: {
        userId: input.userId,
        type: "task",
        status: "active",
        dueDate: { lt: startOfDay },
      },
      select: { title: true, dueDate: true },
      orderBy: { dueDate: "desc" },
      take: 5,
    }),
    prisma.item.count({
      where: {
        userId: input.userId,
        type: "task",
        status: "active",
        dueDate: { lt: startOfDay },
      },
    }),
    prisma.item.findMany({
      where: {
        userId: input.userId,
        type: "task",
        status: "active",
        dueDate: { gte: startOfDay, lt: endOfDay },
      },
      select: { title: true, dueDate: true },
      orderBy: { dueDate: "asc" },
      take: 20,
    }),
    prisma.calendarEvent.findMany({
      where: {
        userId: input.userId,
        calendarListId: { in: visibleCalendarIds },
        startTime: { gte: startOfDay, lt: endOfDay },
        status: "confirmed",
        myResponseStatus: { not: "observer" },
      },
      select: {
        title: true,
        startTime: true,
        endTime: true,
        attendees: true,
        location: true,
        meetingLink: true,
      },
      orderBy: { startTime: "asc" },
      take: 20,
    }),
    prisma.weatherCache.findUnique({
      where: { userId: input.userId },
      select: { current: true, daily: true },
    }).then(async (cache) => {
      if (!cache) return null;
      const user = await prisma.user.findUnique({
        where: { id: input.userId },
        select: { weatherEnabled: true, tempUnit: true, countryCode: true },
      });
      if (!user?.weatherEnabled) return null;
      return { cache, tempUnit: user.tempUnit, countryCode: user.countryCode };
    }),
  ]);

  const dataParts: string[] = [];

  if (overdueCount > 0) {
    const lines = overdueTasksRaw.map(
      (t) => `- ${t.title} (due ${t.dueDate!.toISOString().split("T")[0]})`
    );
    const header = overdueCount > overdueTasksRaw.length
      ? `Overdue tasks (${overdueCount} total, showing ${overdueTasksRaw.length} most recent):`
      : `Overdue tasks (${overdueCount}):`;
    dataParts.push(`${header}\n${lines.join("\n")}`);
  }

  if (dueTodayTasks.length > 0) {
    const lines = dueTodayTasks.map((t) => `- ${t.title}`);
    dataParts.push(`Due today:\n${lines.join("\n")}`);
  }

  if (todayEvents.length > 0) {
    const lines = todayEvents.map((e) => {
      const start = e.startTime.toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        timeZone: timezone,
      });
      const attendeeStr = formatAttendees(e.attendees);
      return `- ${start}: ${e.title}${attendeeStr !== "None" ? ` (with ${attendeeStr})` : ""}`;
    });
    dataParts.push(`Today's calendar:\n${lines.join("\n")}`);
  }

  if (weatherData) {
    const current = weatherData.cache.current as Record<string, unknown>;
    const dailyArr = weatherData.cache.daily as unknown[];
    const daily = dailyArr?.[0] as Record<string, unknown> | undefined;

    // Validate cached data shape before using
    if (typeof current?.temp === "number" && typeof current?.condition === "string") {
      const unit = resolveTempUnit(weatherData.tempUnit, weatherData.countryCode ?? undefined);
      const unitLabel = unit === "fahrenheit" ? "F" : "C";
      const convert = (t: number) => convertTemp(t, unit);

      let weatherBlock = `Current weather: ${convert(current.temp as number)}\u00B0${unitLabel}, ${current.condition}`;
      if (daily && typeof daily.high === "number" && typeof daily.low === "number") {
        weatherBlock += `\nToday: High ${convert(daily.high as number)}\u00B0${unitLabel}, Low ${convert(daily.low as number)}\u00B0${unitLabel}, ${daily.precipProb ?? 0}% chance of rain`;
      }
      const airQuality = current.airQuality as { aqi?: number; category?: string } | undefined;
      if (airQuality && typeof airQuality.aqi === "number") {
        weatherBlock += `\nAir Quality: AQI ${airQuality.aqi} (${airQuality.category ?? "Unknown"})`;
      }
      dataParts.push(weatherBlock);
    }
  }

  const dataBlock =
    dataParts.length > 0
      ? dataParts.join("\n\n")
      : "No tasks due and no calendar events today.";

  const messages: Message[] = [
    {
      role: "user",
      content: `Generate my daily briefing based on the following data:\n\n${wrapUserData("briefing_data", dataBlock)}`,
    },
  ];

  // Briefing runs at most once per day per user but sets the tone for every
  // downstream interaction (chat context, dashboard). The per-request premium
  // of `medium` over `small` is trivial at that frequency; the quality gap is
  // not — `small` produced flatter, more hallucination-prone briefings in
  // evals.
  return { system, messages, modelTier: "medium", toolMode: "none" };
}

async function assembleBrettsTake(
  input: BrettsTakeContext,
  prisma: ExtendedPrismaClient
): Promise<AssembledContext> {
  const [facts, profileBlock] = await Promise.all([
    loadUserFacts(prisma, input.userId),
    loadUserProfile(prisma, input.userId),
  ]);

  const user = await prisma.user.findFirst({
    where: { id: input.userId },
    select: { timezone: true },
  });
  const timezone = user?.timezone ?? "UTC";
  const safeTimezone = VALID_TIMEZONES.has(timezone) ? timezone : "UTC";

  let dataContext = "";

  if (input.itemId) {
    const item = await prisma.item.findFirst({
      where: { id: input.itemId, userId: input.userId },
      select: {
        title: true,
        type: true,
        status: true,
        notes: true,
        dueDate: true,
        dueDatePrecision: true,
        brettObservation: true,
        description: true,
        createdAt: true,
        completedAt: true,
      },
    });
    if (item) {
      const extra: string[] = [];
      if (item.createdAt)
        extra.push(`Created: ${item.createdAt.toISOString().split("T")[0]}`);
      if (item.completedAt)
        extra.push(
          `Completed: ${item.completedAt.toISOString().split("T")[0]}`
        );
      dataContext = wrapUserData(
        "item",
        formatItem(item) + (extra.length > 0 ? "\n" + extra.join("\n") : "")
      );
    }
  }

  if (input.calendarEventId) {
    const event = await prisma.calendarEvent.findFirst({
      where: { id: input.calendarEventId, userId: input.userId },
      select: {
        title: true,
        startTime: true,
        endTime: true,
        description: true,
        location: true,
        myResponseStatus: true,
        attendees: true,
        meetingLink: true,
        recurringEventId: true,
        notes: {
          where: { userId: input.userId },
          take: 1,
          select: { content: true },
        },
      },
    });
    if (event) {
      const contextParts = [formatCalendarEvent(event)];

      // Include user's notes if present
      if (event.notes[0]?.content) {
        contextParts.push(`\nUser's notes:\n${event.notes[0].content}`);
      }

      // For recurring events, include most recent prior meeting summary
      if (event.recurringEventId) {
        const priorMeeting = await prisma.meetingNote.findFirst({
          where: {
            userId: input.userId,
            calendarEvent: {
              recurringEventId: event.recurringEventId,
              startTime: { lt: event.startTime },
            },
          },
          orderBy: { meetingStartedAt: "desc" },
          select: { summary: true },
        });
        if (priorMeeting?.summary) {
          contextParts.push(`\nPrevious meeting summary:\n${priorMeeting.summary}`);
        }
      }

      dataContext = wrapUserData("calendar_event", contextParts.join("\n"));
    }
  }

  const now = new Date();
  const currentTime = now.toLocaleString("en-US", {
    timeZone: safeTimezone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  const currentDate = now.toLocaleDateString("en-CA", { timeZone: safeTimezone });

  const system =
    getBrettsTakePrompt(input.assistantName ?? "Brett") +
    formatFacts(facts) +
    profileBlock +
    formatEmbeddingContext(input.embeddingContext) +
    `\nCurrent date: ${currentDate}` +
    `\nCurrent time: ${currentTime}` +
    `\nTimezone: ${safeTimezone}`;

  const messages: Message[] = [
    {
      role: "user",
      content: dataContext
        ? `Generate your take on this:\n\n${dataContext}`
        : "No item or event data available.",
    },
  ];

  return { system, messages, modelTier: "small", toolMode: "none", maxTokens: 200 };
}

// ─── Main entry point ───

export async function assembleContext(
  input: AssemblerInput,
  prisma: ExtendedPrismaClient
): Promise<AssembledContext> {
  switch (input.type) {
    case "omnibar":
      return assembleOmnibar(input, prisma);
    case "brett_thread":
      return assembleBrettThread(input, prisma);
    case "briefing":
      return assembleBriefing(input, prisma);
    case "bretts_take":
      return assembleBrettsTake(input, prisma);
  }
}
