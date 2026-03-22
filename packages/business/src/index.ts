import type {
  ItemRecord,
  Thing,
  ItemType,
  ItemStatus,
  Urgency,
  DueDatePrecision,
  ReminderType,
  RecurrenceType,
  ContentType,
  ContentStatus,
  CreateItemInput,
  UpdateItemInput,
  CreateListInput,
  UpdateListInput,
  BulkUpdateInput,
  UpcomingSection,
} from "@brett/types";
import { RRule } from "rrule";

// ── Compute helpers ──

/** Strip time component using UTC to avoid timezone drift */
function utcDay(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** UTC start-of-day as a Date — stable for cache keys and date comparisons */
export function getTodayUTC(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** End-of-week (next Sunday midnight UTC) — for "this week" date boundaries */
export function getEndOfWeekUTC(now: Date = new Date()): Date {
  const today = getTodayUTC(now);
  const dayOfWeek = today.getUTCDay(); // 0=Sun
  const daysUntilSunday = dayOfWeek === 0 ? 7 : 7 - dayOfWeek;
  return new Date(today.getTime() + daysUntilSunday * 86400000);
}

export function computeUrgency(
  dueDate: Date | null,
  dueDatePrecision: DueDatePrecision | null,
  completedAt: Date | null,
  now: Date = new Date()
): Urgency {
  if (!dueDate) return completedAt ? "done" : "later";

  // Week-precision dates: urgency comes from the range, not the specific date
  if (dueDatePrecision === "week") {
    const todayMs = utcDay(now);
    const dueMs = utcDay(dueDate);

    // End of this week (next Sunday); on Sunday, "this week" means the upcoming week
    const dayOfWeek = now.getUTCDay();
    const daysUntilSunday = dayOfWeek === 0 ? 7 : 7 - dayOfWeek;
    const endOfThisWeekMs = todayMs + daysUntilSunday * 86400000;
    const endOfNextWeekMs = endOfThisWeekMs + 7 * 86400000;

    // If the stored Sunday has passed, it's overdue
    if (dueMs < todayMs) return "overdue";
    if (dueMs <= endOfThisWeekMs) return "this_week";
    if (dueMs <= endOfNextWeekMs) return "next_week";
    return "later";
  }

  // Day-precision dates: compare exact days
  const todayMs = utcDay(now);
  const dueMs = utcDay(dueDate);

  if (dueMs < todayMs) return "overdue";
  if (dueMs === todayMs) return "today";

  // End of this week (next Sunday); on Sunday, "this week" means the upcoming week
  const dayOfWeek = now.getUTCDay();
  const daysUntilSunday = dayOfWeek === 0 ? 7 : 7 - dayOfWeek;
  const endOfThisWeekMs = todayMs + daysUntilSunday * 86400000;
  const endOfNextWeekMs = endOfThisWeekMs + 7 * 86400000;

  if (dueMs <= endOfThisWeekMs) return "this_week";
  if (dueMs <= endOfNextWeekMs) return "next_week";
  return "later";
}

export function computeDueDateLabel(
  dueDate: Date | null,
  dueDatePrecision: DueDatePrecision | null,
  now: Date = new Date()
): string | undefined {
  if (!dueDate) return undefined;

  // Week-precision: show "This Week" / "Next Week" / "Overdue"
  if (dueDatePrecision === "week") {
    const urgency = computeUrgency(dueDate, "week", null, now);
    if (urgency === "overdue") return "Overdue";
    if (urgency === "this_week") return "This Week";
    if (urgency === "next_week") return "Next Week";
    return dueDate.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
  }

  // Day-precision: show specific date labels
  const todayMs = utcDay(now);
  const dueMs = utcDay(dueDate);
  const diffDays = Math.round((dueMs - todayMs) / (1000 * 60 * 60 * 24));

  if (diffDays < 0) {
    const absDays = Math.abs(diffDays);
    return absDays === 1 ? "1 day ago" : `${absDays} days ago`;
  }
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Tomorrow";

  // Within the same week — show day name
  const dayName = dueDate.toLocaleDateString("en-US", {
    weekday: "short",
    timeZone: "UTC",
  });
  if (diffDays <= 6) return dayName;

  // Further out — show date
  return dueDate.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function computeStalenessDays(
  updatedAt: Date,
  now: Date = new Date()
): number | undefined {
  const diffMs = now.getTime() - updatedAt.getTime();
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  return days >= 2 ? days : undefined;
}

// ── Constants ──

export const DEFAULT_LIST_NAME = "Inbox";

// ── Transform ──

export function itemToThing(
  item: ItemRecord & { list: { name: string } | null },
  now: Date = new Date()
): Thing {
  const precision = (item.dueDatePrecision as DueDatePrecision) ?? null;
  return {
    id: item.id,
    type: item.type as ItemType,
    title: item.title,
    list: item.list?.name ?? DEFAULT_LIST_NAME,
    listId: item.listId,
    status: item.status as ItemStatus,
    source: item.source,
    sourceUrl: item.sourceUrl ?? undefined,
    urgency: computeUrgency(item.dueDate, precision, item.completedAt, now),
    dueDate: item.dueDate?.toISOString(),
    dueDatePrecision: precision ?? undefined,
    dueDateLabel: computeDueDateLabel(item.dueDate, precision, now),
    isCompleted: item.completedAt !== null,
    completedAt: item.completedAt?.toISOString(),
    brettObservation: item.brettObservation ?? undefined,
    description: item.description ?? undefined,
    stalenessDays: computeStalenessDays(item.updatedAt, now),
    createdAt: item.createdAt.toISOString(),
    ...(item.type === "content" && {
      contentType: (item.contentType as ContentType) ?? undefined,
      contentStatus: (item.contentStatus as ContentStatus) ?? undefined,
      contentDomain: item.contentDomain ?? undefined,
      contentImageUrl: item.contentImageUrl ?? undefined,
    }),
  };
}

// ── Validation ──

const VALID_ITEM_TYPES = new Set(["task", "content"]);
const VALID_STATUSES = new Set([
  "active",
  "snoozed",
  "done",
  "archived",
]);
const VALID_PRECISIONS = new Set(["day", "week"]);

export function validateCreateItem(
  input: unknown
): { ok: true; data: CreateItemInput } | { ok: false; error: string } {
  if (!input || typeof input !== "object") {
    return { ok: false, error: "Request body is required" };
  }

  const obj = input as Record<string, unknown>;

  if (!obj.title || typeof obj.title !== "string" || obj.title.trim() === "") {
    return { ok: false, error: "title is required" };
  }

  if (!obj.type || typeof obj.type !== "string") {
    return { ok: false, error: "type is required" };
  }

  if (!VALID_ITEM_TYPES.has(obj.type)) {
    return {
      ok: false,
      error: `type must be one of: ${[...VALID_ITEM_TYPES].join(", ")}`,
    };
  }

  if (obj.listId !== undefined && obj.listId !== null && typeof obj.listId !== "string") {
    return { ok: false, error: "listId must be a string" };
  }

  if (obj.status !== undefined) {
    if (typeof obj.status !== "string" || !VALID_STATUSES.has(obj.status)) {
      return {
        ok: false,
        error: `status must be one of: ${[...VALID_STATUSES].join(", ")}`,
      };
    }
  }

  if (obj.dueDate !== undefined && obj.dueDate !== null) {
    if (typeof obj.dueDate !== "string" || isNaN(Date.parse(obj.dueDate))) {
      return { ok: false, error: "dueDate must be a valid ISO date string" };
    }
  }

  if (obj.dueDatePrecision !== undefined && obj.dueDatePrecision !== null) {
    if (typeof obj.dueDatePrecision !== "string" || !VALID_PRECISIONS.has(obj.dueDatePrecision)) {
      return { ok: false, error: `dueDatePrecision must be one of: ${[...VALID_PRECISIONS].join(", ")}` };
    }
  }

  const VALID_CONTENT_TYPES = new Set(["tweet", "article", "video", "pdf", "podcast", "web_page"]);
  if (obj.contentType !== undefined && obj.contentType !== null) {
    if (typeof obj.contentType !== "string" || !VALID_CONTENT_TYPES.has(obj.contentType)) {
      return { ok: false, error: `contentType must be one of: ${[...VALID_CONTENT_TYPES].join(", ")}` };
    }
  }

  return {
    ok: true,
    data: {
      type: obj.type as string,
      title: (obj.title as string).trim(),
      description:
        typeof obj.description === "string" ? obj.description : undefined,
      source: typeof obj.source === "string" ? obj.source : undefined,
      sourceUrl: typeof obj.sourceUrl === "string" ? obj.sourceUrl : undefined,
      dueDate: typeof obj.dueDate === "string" ? obj.dueDate : undefined,
      dueDatePrecision: typeof obj.dueDatePrecision === "string" ? obj.dueDatePrecision as DueDatePrecision : undefined,
      brettObservation:
        typeof obj.brettObservation === "string"
          ? obj.brettObservation
          : undefined,
      listId: typeof obj.listId === "string" ? obj.listId : undefined,
      status: (obj.status as ItemStatus) ?? undefined,
      contentType: typeof obj.contentType === "string" ? obj.contentType as ContentType : undefined,
    },
  };
}

export function validateUpdateItem(
  input: unknown
): { ok: true; data: UpdateItemInput } | { ok: false; error: string } {
  if (!input || typeof input !== "object") {
    return { ok: false, error: "Request body is required" };
  }

  const obj = input as Record<string, unknown>;
  const data: UpdateItemInput = {};

  if (obj.title !== undefined) {
    if (typeof obj.title !== "string" || obj.title.trim() === "") {
      return { ok: false, error: "title must be a non-empty string" };
    }
    data.title = obj.title.trim();
  }

  if (obj.status !== undefined) {
    if (typeof obj.status !== "string" || !VALID_STATUSES.has(obj.status)) {
      return {
        ok: false,
        error: `status must be one of: ${[...VALID_STATUSES].join(", ")}`,
      };
    }
    data.status = obj.status as ItemStatus;
  }

  if (obj.dueDate !== undefined) {
    if (obj.dueDate !== null) {
      if (typeof obj.dueDate !== "string" || isNaN(Date.parse(obj.dueDate))) {
        return { ok: false, error: "dueDate must be a valid ISO date string or null" };
      }
      data.dueDate = obj.dueDate;
    } else {
      data.dueDate = null;
    }
  }

  if (obj.dueDatePrecision !== undefined) {
    if (obj.dueDatePrecision !== null) {
      if (typeof obj.dueDatePrecision !== "string" || !VALID_PRECISIONS.has(obj.dueDatePrecision)) {
        return { ok: false, error: `dueDatePrecision must be one of: ${[...VALID_PRECISIONS].join(", ")}` };
      }
      data.dueDatePrecision = obj.dueDatePrecision as DueDatePrecision;
    } else {
      data.dueDatePrecision = null;
    }
  }

  if (obj.snoozedUntil !== undefined) {
    if (obj.snoozedUntil !== null) {
      if (typeof obj.snoozedUntil !== "string" || isNaN(Date.parse(obj.snoozedUntil))) {
        return { ok: false, error: "snoozedUntil must be a valid ISO date string or null" };
      }
      data.snoozedUntil = obj.snoozedUntil;
    } else {
      data.snoozedUntil = null;
    }
  }

  // Nullable string fields
  if (obj.description !== undefined) {
    data.description = obj.description === null ? null : typeof obj.description === "string" ? obj.description : undefined;
  }
  if (obj.sourceUrl !== undefined) {
    data.sourceUrl = obj.sourceUrl === null ? null : typeof obj.sourceUrl === "string" ? obj.sourceUrl : undefined;
  }
  if (obj.brettObservation !== undefined) {
    data.brettObservation = obj.brettObservation === null ? null : typeof obj.brettObservation === "string" ? obj.brettObservation : undefined;
  }
  if (obj.listId !== undefined) {
    data.listId = obj.listId === null ? null : typeof obj.listId === "string" ? obj.listId : undefined;
  }
  if (obj.source !== undefined && typeof obj.source === "string") {
    data.source = obj.source;
  }

  // New detail panel fields
  if (obj.notes !== undefined) {
    data.notes = obj.notes === null ? null : typeof obj.notes === "string" ? obj.notes : undefined;
  }
  if (data.notes !== undefined && data.notes !== null && data.notes.length > 100_000) {
    return { ok: false, error: "notes must be 100KB or less" };
  }

  const VALID_REMINDERS = new Set(["morning_of", "1_hour_before", "day_before", "custom"]);
  if (obj.reminder !== undefined) {
    if (obj.reminder !== null && (typeof obj.reminder !== "string" || !VALID_REMINDERS.has(obj.reminder))) {
      return { ok: false, error: `reminder must be one of: ${[...VALID_REMINDERS].join(", ")}` };
    }
    data.reminder = obj.reminder as ReminderType | null;
  }

  const VALID_RECURRENCES = new Set(["daily", "weekly", "monthly", "custom"]);
  if (obj.recurrence !== undefined) {
    if (obj.recurrence !== null && (typeof obj.recurrence !== "string" || !VALID_RECURRENCES.has(obj.recurrence))) {
      return { ok: false, error: `recurrence must be one of: ${[...VALID_RECURRENCES].join(", ")}` };
    }
    data.recurrence = obj.recurrence as RecurrenceType | null;
  }

  if (obj.recurrenceRule !== undefined) {
    data.recurrenceRule = obj.recurrenceRule === null ? null : typeof obj.recurrenceRule === "string" ? obj.recurrenceRule : undefined;
  }
  if (data.recurrenceRule !== undefined && data.recurrenceRule !== null && data.recurrenceRule.length > 500) {
    return { ok: false, error: "recurrenceRule must be 500 characters or less" };
  }

  // Content fields
  const VALID_CONTENT_TYPES = new Set(["tweet", "article", "video", "pdf", "podcast", "web_page"]);
  if (obj.contentType !== undefined) {
    if (obj.contentType !== null && (typeof obj.contentType !== "string" || !VALID_CONTENT_TYPES.has(obj.contentType))) {
      return { ok: false, error: `contentType must be one of: ${[...VALID_CONTENT_TYPES].join(", ")}` };
    }
    data.contentType = obj.contentType as ContentType | null;
  }

  const VALID_CONTENT_STATUSES = new Set(["pending", "extracted", "failed"]);
  if (obj.contentStatus !== undefined) {
    if (obj.contentStatus !== null && (typeof obj.contentStatus !== "string" || !VALID_CONTENT_STATUSES.has(obj.contentStatus))) {
      return { ok: false, error: `contentStatus must be one of: ${[...VALID_CONTENT_STATUSES].join(", ")}` };
    }
    data.contentStatus = obj.contentStatus as ContentStatus | null;
  }

  // Nullable string content fields
  for (const field of ["contentTitle", "contentDescription", "contentImageUrl", "contentFavicon", "contentDomain"] as const) {
    if (obj[field] !== undefined) {
      (data as Record<string, unknown>)[field] = obj[field] === null ? null : typeof obj[field] === "string" ? obj[field] : undefined;
    }
  }

  if (obj.contentBody !== undefined) {
    if (obj.contentBody === null) {
      data.contentBody = null;
    } else if (typeof obj.contentBody === "string") {
      if (obj.contentBody.length > 500_000) {
        return { ok: false, error: "contentBody must be 500KB or less" };
      }
      data.contentBody = obj.contentBody;
    }
  }

  if (obj.contentMetadata !== undefined) {
    if (obj.contentMetadata === null) {
      data.contentMetadata = null;
    } else if (typeof obj.contentMetadata === "object" && !Array.isArray(obj.contentMetadata)) {
      data.contentMetadata = obj.contentMetadata as Record<string, unknown>;
    } else {
      return { ok: false, error: "contentMetadata must be an object or null" };
    }
  }

  return { ok: true, data };
}

export function validateBulkUpdate(
  input: unknown
): { ok: true; data: BulkUpdateInput } | { ok: false; error: string } {
  if (!input || typeof input !== "object") {
    return { ok: false, error: "Request body is required" };
  }

  const obj = input as Record<string, unknown>;

  if (!Array.isArray(obj.ids) || obj.ids.length === 0) {
    return { ok: false, error: "ids must be a non-empty array" };
  }

  if (obj.ids.length > 100) {
    return { ok: false, error: "Maximum 100 items per batch" };
  }

  if (!obj.ids.every((id: unknown) => typeof id === "string")) {
    return { ok: false, error: "All ids must be strings" };
  }

  if (!obj.updates || typeof obj.updates !== "object") {
    return { ok: false, error: "updates object is required" };
  }

  const updates = obj.updates as Record<string, unknown>;

  if (updates.listId !== undefined && updates.listId !== null && typeof updates.listId !== "string") {
    return { ok: false, error: "updates.listId must be a string or null" };
  }

  if (updates.dueDate !== undefined && updates.dueDate !== null) {
    if (typeof updates.dueDate !== "string" || isNaN(Date.parse(updates.dueDate))) {
      return { ok: false, error: "updates.dueDate must be a valid ISO date string or null" };
    }
  }

  if (updates.dueDatePrecision !== undefined && updates.dueDatePrecision !== null) {
    if (typeof updates.dueDatePrecision !== "string" || !VALID_PRECISIONS.has(updates.dueDatePrecision)) {
      return { ok: false, error: `updates.dueDatePrecision must be one of: ${[...VALID_PRECISIONS].join(", ")}` };
    }
  }

  if (updates.status !== undefined) {
    if (typeof updates.status !== "string" || !VALID_STATUSES.has(updates.status)) {
      return {
        ok: false,
        error: `updates.status must be one of: ${[...VALID_STATUSES].join(", ")}`,
      };
    }
  }

  return {
    ok: true,
    data: {
      ids: obj.ids as string[],
      updates: {
        listId: updates.listId as string | null | undefined,
        dueDate: updates.dueDate as string | null | undefined,
        dueDatePrecision: updates.dueDatePrecision as DueDatePrecision | null | undefined,
        status: updates.status as ItemStatus | undefined,
      },
    },
  };
}

export type TriageDatePreset = "today" | "tomorrow" | "this_week" | "next_week" | "next_month";

export interface TriageResult {
  dueDate: string; // ISO string
  dueDatePrecision: DueDatePrecision;
}

export function computeTriageResult(
  preset: TriageDatePreset,
  now: Date = new Date()
): TriageResult {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  switch (preset) {
    case "today":
      return { dueDate: d.toISOString(), dueDatePrecision: "day" };
    case "tomorrow":
      d.setUTCDate(d.getUTCDate() + 1);
      return { dueDate: d.toISOString(), dueDatePrecision: "day" };
    case "this_week": {
      // Next Sunday (end of current week); if already Sunday, use next Sunday
      const dayOfWeek = d.getUTCDay(); // 0=Sun
      const daysUntilSunday = dayOfWeek === 0 ? 7 : 7 - dayOfWeek;
      d.setUTCDate(d.getUTCDate() + daysUntilSunday);
      return { dueDate: d.toISOString(), dueDatePrecision: "week" };
    }
    case "next_week": {
      // Sunday after "this_week" Sunday
      const dayOfWeek = d.getUTCDay();
      const daysUntilSunday = dayOfWeek === 0 ? 7 : 7 - dayOfWeek;
      d.setUTCDate(d.getUTCDate() + daysUntilSunday + 7);
      return { dueDate: d.toISOString(), dueDatePrecision: "week" };
    }
    case "next_month":
      d.setUTCMonth(d.getUTCMonth() + 1, 1);
      return { dueDate: d.toISOString(), dueDatePrecision: "day" };
  }
}

export function computeRelativeAge(
  createdAt: Date,
  now: Date = new Date()
): string {
  const diffMs = now.getTime() - createdAt.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${diffDays}d ago`;
}

/** Tailwind colorClass → hex value map (used by LeftNav, ListView, etc.) */
export const COLOR_MAP: Record<string, string> = {
  "bg-blue-400": "#60a5fa",
  "bg-emerald-400": "#34d399",
  "bg-violet-400": "#a78bfa",
  "bg-amber-400": "#fbbf24",
  "bg-rose-400": "#fb7185",
  "bg-sky-400": "#38bdf8",
  "bg-orange-400": "#fb923c",
  "bg-slate-400": "#94a3b8",
  // Legacy values from before palette update
  "bg-blue-500": "#3b82f6",
  "bg-green-500": "#22c55e",
  "bg-purple-500": "#a855f7",
  "bg-amber-500": "#f59e0b",
  "bg-red-500": "#ef4444",
  "bg-pink-500": "#ec4899",
  "bg-cyan-500": "#06b6d4",
  "bg-orange-500": "#f97316",
  "bg-gray-500": "rgba(255,255,255,0.4)",
};

/** Current-palette color swatches for the color picker UI */
export const COLOR_SWATCHES = [
  "bg-blue-400",
  "bg-emerald-400",
  "bg-violet-400",
  "bg-amber-400",
  "bg-rose-400",
  "bg-sky-400",
  "bg-orange-400",
  "bg-slate-400",
];

const VALID_COLOR_CLASSES = new Set([
  "bg-blue-400", "bg-emerald-400", "bg-violet-400", "bg-amber-400",
  "bg-rose-400", "bg-sky-400", "bg-orange-400", "bg-slate-400",
  // Legacy values
  "bg-blue-500", "bg-green-500", "bg-purple-500", "bg-amber-500",
  "bg-red-500", "bg-pink-500", "bg-cyan-500", "bg-orange-500", "bg-gray-500",
]);

const MAX_LIST_NAME_LENGTH = 100;

function validateListName(name: unknown): { ok: true; value: string } | { ok: false; error: string } {
  if (!name || typeof name !== "string" || name.trim() === "") {
    return { ok: false, error: "name is required" };
  }
  if (name.trim().length > MAX_LIST_NAME_LENGTH) {
    return { ok: false, error: `name must be ${MAX_LIST_NAME_LENGTH} characters or fewer` };
  }
  return { ok: true, value: name.trim() };
}

function validateColorClass(colorClass: unknown): string | undefined {
  if (typeof colorClass !== "string") return undefined;
  return VALID_COLOR_CLASSES.has(colorClass) ? colorClass : undefined;
}

export function validateCreateList(
  input: unknown
): { ok: true; data: CreateListInput } | { ok: false; error: string } {
  if (!input || typeof input !== "object") {
    return { ok: false, error: "Request body is required" };
  }

  const obj = input as Record<string, unknown>;
  const nameResult = validateListName(obj.name);
  if (!nameResult.ok) return nameResult;

  return {
    ok: true,
    data: {
      name: nameResult.value,
      colorClass: validateColorClass(obj.colorClass),
    },
  };
}

export function validateUpdateList(
  input: unknown
): { ok: true; data: UpdateListInput } | { ok: false; error: string } {
  if (!input || typeof input !== "object") {
    return { ok: false, error: "Request body is required" };
  }

  const obj = input as Record<string, unknown>;
  const data: UpdateListInput = {};

  if (obj.name !== undefined) {
    const nameResult = validateListName(obj.name);
    if (!nameResult.ok) return nameResult;
    data.name = nameResult.value;
  }

  if (obj.colorClass !== undefined) {
    const validated = validateColorClass(obj.colorClass);
    if (!validated) return { ok: false, error: "invalid colorClass" };
    data.colorClass = validated;
  }

  return { ok: true, data };
}

// ── Upcoming grouping ──

export function groupUpcomingThings(things: Thing[], now: Date = new Date()): UpcomingSection[] {
  if (things.length === 0) return [];

  const todayMs = utcDay(now);
  const sections: UpcomingSection[] = [];
  const placed = new Set<string>();
  const DAY_MS = 86400000;

  // 1. Per-day sections for next 7 days (day-precision only)
  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  for (let offset = 1; offset <= 7; offset++) {
    const dayMs = todayMs + offset * DAY_MS;
    const dayThings = things.filter((t) => {
      if (t.dueDatePrecision !== "day" || !t.dueDate) return false;
      return utcDay(new Date(t.dueDate)) === dayMs;
    });
    if (dayThings.length > 0) {
      const d = new Date(dayMs);
      const label = offset === 1 ? "Tomorrow" : dayNames[d.getUTCDay()];
      sections.push({ label, things: dayThings });
      dayThings.forEach((t) => placed.add(t.id));
    }
  }

  // 2. "This Week" — any unplaced items due within this week's range
  const dayOfWeek = now.getUTCDay(); // 0=Sun
  const daysUntilSunday = dayOfWeek === 0 ? 7 : 7 - dayOfWeek;
  const thisWeekEndMs = todayMs + daysUntilSunday * DAY_MS;

  const thisWeekThings = things.filter((t) => {
    if (placed.has(t.id) || !t.dueDate) return false;
    const dueMs = utcDay(new Date(t.dueDate));
    return dueMs > todayMs && dueMs <= thisWeekEndMs;
  });
  if (thisWeekThings.length > 0) {
    sections.push({ label: "This Week", things: thisWeekThings });
    thisWeekThings.forEach((t) => placed.add(t.id));
  }

  // 3. "Next Week" — any unplaced items due within next week's range
  const nextWeekEndMs = thisWeekEndMs + 7 * DAY_MS;
  const nextWeekThings = things.filter((t) => {
    if (placed.has(t.id) || !t.dueDate) return false;
    const dueMs = utcDay(new Date(t.dueDate));
    return dueMs > thisWeekEndMs && dueMs <= nextWeekEndMs;
  });
  if (nextWeekThings.length > 0) {
    sections.push({ label: "Next Week", things: nextWeekThings });
    nextWeekThings.forEach((t) => placed.add(t.id));
  }

  // 4. Future weekly ranges (Mon-Sun) for remaining items
  const remaining = things.filter((t) => !placed.has(t.id) && t.dueDate);
  if (remaining.length > 0) {
    const rangeStartMs = nextWeekEndMs + DAY_MS; // Monday after next week

    let maxDueMs = 0;
    remaining.forEach((t) => {
      const dueMs = utcDay(new Date(t.dueDate!));
      if (dueMs > maxDueMs) maxDueMs = dueMs;
    });

    let weekStart = rangeStartMs;
    while (weekStart <= maxDueMs) {
      const weekEnd = weekStart + 6 * DAY_MS;
      const weekThings = remaining.filter((t) => {
        const dueMs = utcDay(new Date(t.dueDate!));
        return dueMs >= weekStart && dueMs <= weekEnd;
      });
      if (weekThings.length > 0) {
        const startDate = new Date(weekStart);
        const endDate = new Date(weekEnd);
        const fmt = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
        sections.push({ label: `${fmt(startDate)} – ${fmt(endDate)}`, things: weekThings });
      }
      weekStart += 7 * DAY_MS;
    }
  }

  return sections;
}

// ── Detail panel validation ──

export function validateCreateItemLink(
  input: unknown
): { ok: true; data: { toItemId: string; toItemType: string } } | { ok: false; error: string } {
  if (!input || typeof input !== "object") {
    return { ok: false, error: "Request body is required" };
  }
  const obj = input as Record<string, unknown>;
  if (!obj.toItemId || typeof obj.toItemId !== "string") {
    return { ok: false, error: "toItemId is required" };
  }
  if (!obj.toItemType || typeof obj.toItemType !== "string") {
    return { ok: false, error: "toItemType is required" };
  }
  const VALID_LINK_TYPES = new Set(["task", "content"]);
  if (!VALID_LINK_TYPES.has(obj.toItemType)) {
    return { ok: false, error: `toItemType must be one of: ${[...VALID_LINK_TYPES].join(", ")}` };
  }
  return { ok: true, data: { toItemId: obj.toItemId, toItemType: obj.toItemType } };
}

export function validateCreateBrettMessage(
  input: unknown
): { ok: true; data: { content: string } } | { ok: false; error: string } {
  if (!input || typeof input !== "object") {
    return { ok: false, error: "Request body is required" };
  }
  const obj = input as Record<string, unknown>;
  if (!obj.content || typeof obj.content !== "string" || obj.content.trim() === "") {
    return { ok: false, error: "content is required" };
  }
  if (obj.content.trim().length > 10_000) {
    return { ok: false, error: "content must be 10KB or less" };
  }
  return { ok: true, data: { content: obj.content.trim() } };
}

// ── Calendar validation ──

export { validateRsvpInput, validateCalendarNoteInput } from "./calendar-validation";

// ── Recurrence ──

export function computeNextDueDate(
  currentDueDate: Date | null,
  recurrence: string,
  recurrenceRule: string | null
): Date | null {
  if (!currentDueDate) return null;

  const base = new Date(currentDueDate);

  switch (recurrence) {
    case "daily":
      base.setUTCDate(base.getUTCDate() + 1);
      return base;
    case "weekly":
      base.setUTCDate(base.getUTCDate() + 7);
      return base;
    case "monthly":
      base.setUTCMonth(base.getUTCMonth() + 1);
      return base;
    case "custom":
      if (recurrenceRule) {
        try {
          const rule = RRule.fromString(recurrenceRule);
          const next = rule.after(currentDueDate);
          return next || null;
        } catch {
          return null;
        }
      }
      return null;
    default:
      return null;
  }
}
