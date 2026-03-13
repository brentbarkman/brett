import type {
  Task,
  ItemRecord,
  Thing,
  ItemType,
  ItemStatus,
  Urgency,
  CreateItemInput,
  CreateListInput,
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
  completedAt: Date | null,
  now: Date = new Date()
): Urgency {
  if (completedAt) return "done";
  if (!dueDate) return "this_week"; // no due date → default bucket

  const todayMs = utcDay(now);
  const dueMs = utcDay(dueDate);

  if (dueMs < todayMs) return "overdue";
  if (dueMs === todayMs) return "today";
  return "this_week";
}

export function computeDueDateLabel(
  dueDate: Date | null,
  now: Date = new Date()
): string | undefined {
  if (!dueDate) return undefined;

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
  return {
    id: item.id,
    type: item.type as ItemType,
    title: item.title,
    list: item.list?.name ?? DEFAULT_LIST_NAME,
    listId: item.listId,
    status: item.status as ItemStatus,
    source: item.source,
    sourceUrl: item.sourceUrl ?? undefined,
    urgency: computeUrgency(item.dueDate, item.completedAt, now),
    dueDateLabel: computeDueDateLabel(item.dueDate, now),
    isCompleted: item.completedAt !== null,
    brettObservation: item.brettObservation ?? undefined,
    description: item.description ?? undefined,
    stalenessDays: computeStalenessDays(item.updatedAt, now),
  };
}

// ── Validation ──

const VALID_ITEM_TYPES = new Set(["task", "content"]);
const VALID_STATUSES = new Set([
  "inbox",
  "active",
  "snoozed",
  "done",
  "archived",
]);

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
      brettObservation:
        typeof obj.brettObservation === "string"
          ? obj.brettObservation
          : undefined,
      listId: typeof obj.listId === "string" ? obj.listId : undefined,
      status: (obj.status as ItemStatus) ?? undefined,
    },
  };
}

export function validateCreateList(
  input: unknown
): { ok: true; data: CreateListInput } | { ok: false; error: string } {
  if (!input || typeof input !== "object") {
    return { ok: false, error: "Request body is required" };
  }

  const obj = input as Record<string, unknown>;

  if (!obj.name || typeof obj.name !== "string" || obj.name.trim() === "") {
    return { ok: false, error: "name is required" };
  }

  return {
    ok: true,
    data: {
      name: (obj.name as string).trim(),
      colorClass:
        typeof obj.colorClass === "string" ? obj.colorClass : undefined,
    },
  };
}
