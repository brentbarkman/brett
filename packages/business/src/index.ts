import type {
  Task,
  ItemRecord,
  Thing,
  ItemType,
  ItemStatus,
  Urgency,
  DueDatePrecision,
  CreateItemInput,
  CreateListInput,
  UpdateListInput,
  BulkUpdateInput,
  UpcomingSection,
} from "@brett/types";
import { generateId } from "@brett/utils";

// ── Legacy (deprecated) ──

/** @deprecated Use itemToThing() pipeline instead */
export function createTask(
  title: string,
  userId: string,
  description?: string
): Task {
  const now = new Date();
  return {
    id: generateId(),
    title,
    description,
    completed: false,
    userId,
    createdAt: now,
    updatedAt: now,
  };
}

/** @deprecated Use itemToThing() pipeline instead */
export function toggleTask(task: Task): Task {
  return {
    ...task,
    completed: !task.completed,
    updatedAt: new Date(),
  };
}

// ── Compute helpers ──

/** Strip time component using UTC to avoid timezone drift */
function utcDay(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
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
    },
  };
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

/** @deprecated Use computeTriageResult instead */
export function computeTriageDate(
  preset: TriageDatePreset,
  now: Date = new Date()
): string {
  return computeTriageResult(preset, now).dueDate;
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

  // 2. "This Week" — week-precision items for current week
  const dayOfWeek = now.getUTCDay(); // 0=Sun
  const daysUntilSunday = dayOfWeek === 0 ? 7 : 7 - dayOfWeek;
  const thisWeekEndMs = todayMs + daysUntilSunday * DAY_MS;

  const thisWeekThings = things.filter((t) => {
    if (placed.has(t.id) || t.dueDatePrecision !== "week" || !t.dueDate) return false;
    const dueMs = utcDay(new Date(t.dueDate));
    return dueMs > todayMs && dueMs <= thisWeekEndMs;
  });
  if (thisWeekThings.length > 0) {
    sections.push({ label: "This Week", things: thisWeekThings });
    thisWeekThings.forEach((t) => placed.add(t.id));
  }

  // 3. "Next Week"
  const nextWeekEndMs = thisWeekEndMs + 7 * DAY_MS;
  const nextWeekThings = things.filter((t) => {
    if (placed.has(t.id) || t.dueDatePrecision !== "week" || !t.dueDate) return false;
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
