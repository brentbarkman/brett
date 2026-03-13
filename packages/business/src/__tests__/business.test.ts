import { describe, it, expect } from "vitest";
import {
  computeUrgency,
  computeDueDateLabel,
  computeStalenessDays,
  itemToThing,
  validateCreateItem,
  validateCreateList,
  validateBulkUpdate,
  computeRelativeAge,
  computeTriageDate,
} from "../index";
import type { ItemRecord } from "@brett/types";

const NOW = new Date("2026-03-13T12:00:00Z");

function makeItem(overrides: Partial<ItemRecord> = {}): ItemRecord & { list: { name: string } } {
  return {
    id: "item-1",
    type: "task",
    status: "active",
    title: "Test item",
    description: null,
    source: "Brett",
    sourceUrl: null,
    dueDate: null,
    completedAt: null,
    snoozedUntil: null,
    brettObservation: null,
    listId: "list-1",
    userId: "user-1",
    createdAt: new Date("2026-03-10T10:00:00Z"),
    updatedAt: new Date("2026-03-13T10:00:00Z"),
    list: { name: "Work" },
    ...overrides,
  };
}

// ── computeUrgency ──

describe("computeUrgency", () => {
  it("returns 'done' when completedAt is set", () => {
    expect(computeUrgency(new Date("2026-03-10"), new Date("2026-03-12"), NOW)).toBe("done");
  });

  it("returns 'overdue' when dueDate is before today", () => {
    expect(computeUrgency(new Date("2026-03-10"), null, NOW)).toBe("overdue");
  });

  it("returns 'today' when dueDate is today", () => {
    expect(computeUrgency(new Date("2026-03-13"), null, NOW)).toBe("today");
  });

  it("returns 'this_week' when dueDate is in the future", () => {
    expect(computeUrgency(new Date("2026-03-15"), null, NOW)).toBe("this_week");
  });

  it("returns 'this_week' when no dueDate", () => {
    expect(computeUrgency(null, null, NOW)).toBe("this_week");
  });

  it("midnight boundary: due today at midnight still counts as today", () => {
    const midnight = new Date("2026-03-13T00:00:00Z");
    expect(computeUrgency(midnight, null, NOW)).toBe("today");
  });
});

// ── computeDueDateLabel ──

describe("computeDueDateLabel", () => {
  it("returns undefined for null dueDate", () => {
    expect(computeDueDateLabel(null, NOW)).toBeUndefined();
  });

  it("returns 'Today' for today", () => {
    expect(computeDueDateLabel(new Date("2026-03-13"), NOW)).toBe("Today");
  });

  it("returns 'Tomorrow' for tomorrow", () => {
    expect(computeDueDateLabel(new Date("2026-03-14"), NOW)).toBe("Tomorrow");
  });

  it("returns '1 day ago' for yesterday", () => {
    expect(computeDueDateLabel(new Date("2026-03-12"), NOW)).toBe("1 day ago");
  });

  it("returns 'N days ago' for past dates", () => {
    expect(computeDueDateLabel(new Date("2026-03-10"), NOW)).toBe("3 days ago");
  });

  it("returns short day name within the week", () => {
    const label = computeDueDateLabel(new Date("2026-03-16"), NOW);
    expect(label).toBe("Mon");
  });

  it("returns month+day for dates more than 6 days out", () => {
    const label = computeDueDateLabel(new Date("2026-03-25"), NOW);
    expect(label).toBe("Mar 25");
  });
});

// ── computeStalenessDays ──

describe("computeStalenessDays", () => {
  it("returns undefined when updated recently", () => {
    expect(computeStalenessDays(new Date("2026-03-12"), NOW)).toBeUndefined();
  });

  it("returns day count when stale", () => {
    expect(computeStalenessDays(new Date("2026-03-09"), NOW)).toBe(4);
  });

  it("returns 2 at the threshold", () => {
    expect(computeStalenessDays(new Date("2026-03-11T12:00:00Z"), NOW)).toBe(2);
  });
});

// ── itemToThing ──

describe("itemToThing", () => {
  it("transforms a basic item to a Thing", () => {
    const item = makeItem({ dueDate: new Date("2026-03-13") });
    const thing = itemToThing(item, NOW);

    expect(thing.id).toBe("item-1");
    expect(thing.type).toBe("task");
    expect(thing.list).toBe("Work");
    expect(thing.listId).toBe("list-1");
    expect(thing.status).toBe("active");
    expect(thing.source).toBe("Brett");
    expect(thing.urgency).toBe("today");
    expect(thing.dueDateLabel).toBe("Today");
    expect(thing.isCompleted).toBe(false);
  });

  it("marks completed items", () => {
    const item = makeItem({ completedAt: new Date("2026-03-12") });
    const thing = itemToThing(item, NOW);

    expect(thing.isCompleted).toBe(true);
    expect(thing.urgency).toBe("done");
  });

  it("converts null fields to undefined", () => {
    const item = makeItem();
    const thing = itemToThing(item, NOW);

    expect(thing.description).toBeUndefined();
    expect(thing.brettObservation).toBeUndefined();
    expect(thing.sourceUrl).toBeUndefined();
  });
});

// ── validateCreateItem ──

describe("validateCreateItem", () => {
  const validInput = {
    type: "task",
    title: "My task",
    listId: "list-1",
  };

  it("accepts valid input", () => {
    const result = validateCreateItem(validInput);
    expect(result.ok).toBe(true);
  });

  it("rejects missing title", () => {
    const result = validateCreateItem({ ...validInput, title: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("title");
  });

  it("rejects missing type", () => {
    const result = validateCreateItem({ ...validInput, type: undefined });
    expect(result.ok).toBe(false);
  });

  it("rejects invalid type", () => {
    const result = validateCreateItem({ ...validInput, type: "banana" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("type");
  });

  it("accepts content type", () => {
    const result = validateCreateItem({ ...validInput, type: "content" });
    expect(result.ok).toBe(true);
  });

  it("accepts missing listId (inbox item)", () => {
    const result = validateCreateItem({ ...validInput, listId: undefined });
    expect(result.ok).toBe(true);
  });

  it("rejects invalid status", () => {
    const result = validateCreateItem({ ...validInput, status: "nope" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("status");
  });

  it("rejects invalid dueDate", () => {
    const result = validateCreateItem({ ...validInput, dueDate: "not-a-date" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("dueDate");
  });

  it("accepts optional fields", () => {
    const result = validateCreateItem({
      ...validInput,
      description: "desc",
      source: "Scout",
      dueDate: "2026-03-15T00:00:00Z",
      status: "active",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.description).toBe("desc");
      expect(result.data.source).toBe("Scout");
      expect(result.data.status).toBe("active");
    }
  });

  it("rejects inbox as a status", () => {
    const result = validateCreateItem({ ...validInput, status: "inbox" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("status");
  });

  it("rejects null body", () => {
    expect(validateCreateItem(null).ok).toBe(false);
  });
});

// ── validateBulkUpdate ──

describe("validateBulkUpdate", () => {
  it("accepts valid bulk update with listId", () => {
    const result = validateBulkUpdate({
      ids: ["id-1", "id-2"],
      updates: { listId: "list-1" },
    });
    expect(result.ok).toBe(true);
  });

  it("accepts bulk update with dueDate", () => {
    const result = validateBulkUpdate({
      ids: ["id-1"],
      updates: { dueDate: "2026-03-15T00:00:00Z" },
    });
    expect(result.ok).toBe(true);
  });

  it("accepts bulk update with status", () => {
    const result = validateBulkUpdate({
      ids: ["id-1"],
      updates: { status: "archived" },
    });
    expect(result.ok).toBe(true);
  });

  it("rejects empty ids", () => {
    const result = validateBulkUpdate({ ids: [], updates: { listId: "x" } });
    expect(result.ok).toBe(false);
  });

  it("rejects more than 100 ids", () => {
    const ids = Array.from({ length: 101 }, (_, i) => `id-${i}`);
    const result = validateBulkUpdate({ ids, updates: { listId: "x" } });
    expect(result.ok).toBe(false);
  });

  it("rejects invalid status", () => {
    const result = validateBulkUpdate({
      ids: ["id-1"],
      updates: { status: "inbox" },
    });
    expect(result.ok).toBe(false);
  });

  it("rejects missing updates", () => {
    const result = validateBulkUpdate({ ids: ["id-1"] });
    expect(result.ok).toBe(false);
  });

  it("rejects null body", () => {
    expect(validateBulkUpdate(null).ok).toBe(false);
  });
});

// ── computeRelativeAge ──

describe("computeRelativeAge", () => {
  it("returns 'just now' for < 1 minute", () => {
    const created = new Date(NOW.getTime() - 30 * 1000);
    expect(computeRelativeAge(created, NOW)).toBe("just now");
  });

  it("returns minutes for < 1 hour", () => {
    const created = new Date(NOW.getTime() - 25 * 60 * 1000);
    expect(computeRelativeAge(created, NOW)).toBe("25m ago");
  });

  it("returns hours for < 24 hours", () => {
    const created = new Date(NOW.getTime() - 5 * 60 * 60 * 1000);
    expect(computeRelativeAge(created, NOW)).toBe("5h ago");
  });

  it("returns days for >= 24 hours", () => {
    const created = new Date(NOW.getTime() - 3 * 24 * 60 * 60 * 1000);
    expect(computeRelativeAge(created, NOW)).toBe("3d ago");
  });
});

// ── computeTriageDate ──

describe("computeTriageDate", () => {
  // NOW = 2026-03-13 (Friday)
  it("today returns today", () => {
    const result = computeTriageDate("today", NOW);
    expect(result).toBe("2026-03-13T00:00:00.000Z");
  });

  it("tomorrow returns next day", () => {
    const result = computeTriageDate("tomorrow", NOW);
    expect(result).toBe("2026-03-14T00:00:00.000Z");
  });

  it("this_week returns Sunday", () => {
    const result = computeTriageDate("this_week", NOW);
    expect(result).toBe("2026-03-15T00:00:00.000Z");
  });

  it("next_week returns next Monday", () => {
    const result = computeTriageDate("next_week", NOW);
    expect(result).toBe("2026-03-16T00:00:00.000Z");
  });

  it("next_month returns 1st of next month", () => {
    const result = computeTriageDate("next_month", NOW);
    expect(result).toBe("2026-04-01T00:00:00.000Z");
  });
});

// ── validateCreateList ──

describe("validateCreateList", () => {
  it("accepts valid input", () => {
    const result = validateCreateList({ name: "Work" });
    expect(result.ok).toBe(true);
  });

  it("rejects empty name", () => {
    const result = validateCreateList({ name: "  " });
    expect(result.ok).toBe(false);
  });

  it("trims name", () => {
    const result = validateCreateList({ name: "  Work  " });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.name).toBe("Work");
  });

  it("rejects null body", () => {
    expect(validateCreateList(null).ok).toBe(false);
  });
});
