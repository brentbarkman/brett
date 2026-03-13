import { describe, it, expect } from "vitest";
import {
  computeUrgency,
  computeDueDateLabel,
  computeStalenessDays,
  itemToThing,
  validateCreateItem,
  validateCreateList,
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

  it("rejects missing listId", () => {
    const result = validateCreateItem({ ...validInput, listId: undefined });
    expect(result.ok).toBe(false);
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

  it("rejects null body", () => {
    expect(validateCreateItem(null).ok).toBe(false);
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
