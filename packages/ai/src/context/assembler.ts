import type { PrismaClient } from "@prisma/client";
import type { ModelTier } from "@brett/types";
import type { Message } from "../providers/types.js";
import {
  BRETT_SYSTEM_PROMPT,
  BRIEFING_SYSTEM_PROMPT,
  BRETTS_TAKE_SYSTEM_PROMPT,
} from "./system-prompts.js";
import { AI_CONFIG } from "../config.js";
import { getUserDayBounds } from "@brett/business";

// ─── Input types ───

interface OmnibarContext {
  type: "omnibar";
  userId: string;
  message: string;
  sessionMessages?: Array<{ role: string; content: string }>;
  currentView?: string;
  selectedItemId?: string;
}

interface BrettThreadContext {
  type: "brett_thread";
  userId: string;
  message: string;
  itemId?: string;
  calendarEventId?: string;
}

interface BriefingContext {
  type: "briefing";
  userId: string;
  timezone: string;
}

interface BrettsTakeContext {
  type: "bretts_take";
  userId: string;
  itemId?: string;
  calendarEventId?: string;
}

export type AssemblerInput =
  | OmnibarContext
  | BrettThreadContext
  | BriefingContext
  | BrettsTakeContext;

export interface AssembledContext {
  system: string;
  messages: Message[];
  modelTier: ModelTier;
}

// ─── Constants ───

const VALID_VIEWS = ["today", "upcoming", "inbox", "settings", "calendar"];
const CUID_PATTERN = /^[a-z0-9]{20,30}$/;
const MAX_FACTS = AI_CONFIG.context.maxFacts;

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

async function loadUserFacts(
  prisma: PrismaClient,
  userId: string
): Promise<Array<{ category: string; key: string; value: string }>> {
  const facts = await prisma.userFact.findMany({
    where: { userId },
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
  prisma: PrismaClient
): Promise<AssembledContext> {
  const facts = await loadUserFacts(prisma, input.userId);

  const system =
    BRETT_SYSTEM_PROMPT + formatFacts(facts) + currentDateLine();

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

  const userContent = viewContext
    ? `${viewContext}\n\n${input.message}`
    : input.message;

  messages.push({ role: "user", content: userContent });

  // Complex requests (multi-action, long messages) start on medium model
  // for better reasoning. Simple requests stay on small for speed/cost.
  const lower = input.message.toLowerCase();
  const actionWords = lower.match(/\b(create|make|move|add|put|delete|remove|archive|update|change|snooze|complete|done|mark)\b/g);
  const isComplex = lower.length > 80 || (actionWords && actionWords.length >= 2);
  const tier = isComplex ? "medium" : "small";

  return { system, messages, modelTier: tier };
}

async function assembleBrettThread(
  input: BrettThreadContext,
  prisma: PrismaClient
): Promise<AssembledContext> {
  const facts = await loadUserFacts(prisma, input.userId);

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
    BRETT_SYSTEM_PROMPT +
    formatFacts(facts) +
    itemContext +
    currentDateLine();

  // Item context + user facts provide sufficient memory for Brett threads.
  // Past session history was ~2,000-3,000 tokens of low-value back-and-forth.
  const messages: Message[] = [
    { role: "user", content: input.message },
  ];

  return { system, messages, modelTier: "medium" };
}

async function assembleBriefing(
  input: BriefingContext,
  prisma: PrismaClient
): Promise<AssembledContext> {
  const facts = await loadUserFacts(prisma, input.userId);

  // Validate timezone at point-of-use (defense-in-depth)
  const timezone = input.timezone;
  let currentDate: string;
  try {
    currentDate = new Date().toLocaleDateString("en-CA", { timeZone: timezone });
  } catch {
    currentDate = new Date().toLocaleDateString("en-CA", { timeZone: "UTC" });
  }

  const system =
    BRIEFING_SYSTEM_PROMPT +
    formatFacts(facts) +
    `\nCurrent date: ${currentDate}` +
    `\nCurrent timezone: ${timezone}`;

  const { startOfDay, endOfDay } = getUserDayBounds(timezone);

  const [overdueTasks, dueTodayTasks, todayEvents] = await Promise.all([
    prisma.item.findMany({
      where: {
        userId: input.userId,
        type: "task",
        status: "active",
        dueDate: { lt: startOfDay },
      },
      select: { title: true, dueDate: true },
      orderBy: { dueDate: "asc" },
      take: 20,
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
        startTime: { gte: startOfDay, lt: endOfDay },
        status: "confirmed",
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
  ]);

  const dataParts: string[] = [];

  if (overdueTasks.length > 0) {
    const lines = overdueTasks.map(
      (t) => `- ${t.title} (due ${t.dueDate!.toISOString().split("T")[0]})`
    );
    dataParts.push(`Overdue tasks:\n${lines.join("\n")}`);
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

  return { system, messages, modelTier: "medium" };
}

async function assembleBrettsTake(
  input: BrettsTakeContext,
  prisma: PrismaClient
): Promise<AssembledContext> {
  const facts = await loadUserFacts(prisma, input.userId);

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
      },
    });
    if (event) {
      dataContext = wrapUserData(
        "calendar_event",
        formatCalendarEvent(event)
      );
    }
  }

  const system =
    BRETTS_TAKE_SYSTEM_PROMPT +
    formatFacts(facts) +
    currentDateLine();

  const messages: Message[] = [
    {
      role: "user",
      content: dataContext
        ? `Generate your take on this:\n\n${dataContext}`
        : "No item or event data available.",
    },
  ];

  return { system, messages, modelTier: "medium" };
}

// ─── Main entry point ───

export async function assembleContext(
  input: AssemblerInput,
  prisma: PrismaClient
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
