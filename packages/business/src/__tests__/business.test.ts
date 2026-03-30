import { describe, it, expect } from "vitest";
import {
  computeUrgency,
  computeDueDateLabel,
  computeStalenessDays,
  itemToThing,
  validateCreateItem,
  validateCreateList,
  validateUpdateList,
  validateBulkUpdate,
  computeRelativeAge,
  computeTriageResult,
  groupUpcomingThings,
} from "../index";
import type { ItemRecord, Urgency, DueDatePrecision, Thing } from "@brett/types";

const NOW = new Date("2026-03-13T12:00:00Z"); // Friday

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
    dueDatePrecision: null,
    completedAt: null,
    snoozedUntil: null,
    brettObservation: null,
    notes: null,
    reminder: null,
    recurrence: null,
    recurrenceRule: null,
    brettTakeGeneratedAt: null,
    contentType: null,
    contentStatus: null,
    contentTitle: null,
    contentDescription: null,
    contentImageUrl: null,
    contentBody: null,
    contentFavicon: null,
    contentDomain: null,
    contentMetadata: null,
    meetingNoteId: null,
    listId: "list-1",
    sourceId: null,
    userId: "user-1",
    createdAt: new Date("2026-03-10T10:00:00Z"),
    updatedAt: new Date("2026-03-13T10:00:00Z"),
    list: { name: "Work" },
    ...overrides,
  };
}

// ── computeUrgency ──

describe("computeUrgency", () => {
  // NOW = 2026-03-13 (Friday)

  describe("day-precision dates", () => {
    it("overdue when dueDate is before today", () => {
      expect(computeUrgency(new Date("2026-03-10"), "day", null, NOW)).toBe("overdue");
    });

    it("today when dueDate is today", () => {
      expect(computeUrgency(new Date("2026-03-13"), "day", null, NOW)).toBe("today");
    });

    it("this_week when dueDate is later this week", () => {
      expect(computeUrgency(new Date("2026-03-14"), "day", null, NOW)).toBe("this_week");
      expect(computeUrgency(new Date("2026-03-15"), "day", null, NOW)).toBe("this_week");
    });

    it("next_week when dueDate is next week", () => {
      expect(computeUrgency(new Date("2026-03-18"), "day", null, NOW)).toBe("next_week");
    });

    it("later when dueDate is beyond next week", () => {
      expect(computeUrgency(new Date("2026-03-25"), "day", null, NOW)).toBe("later");
    });

    it("midnight boundary: due today at midnight is today", () => {
      expect(computeUrgency(new Date("2026-03-13T00:00:00Z"), "day", null, NOW)).toBe("today");
    });

    it("end-of-day boundary: due today at 23:59 is today", () => {
      expect(computeUrgency(new Date("2026-03-13T23:59:59Z"), "day", null, NOW)).toBe("today");
    });

    it("tomorrow is this_week (not today)", () => {
      expect(computeUrgency(new Date("2026-03-14"), "day", null, NOW)).toBe("this_week");
    });
  });

  describe("week-precision dates", () => {
    it("this_week when stored Sunday is end of current week", () => {
      // Friday → end of week is Sunday March 15
      expect(computeUrgency(new Date("2026-03-15"), "week", null, NOW)).toBe("this_week");
    });

    it("next_week when stored Sunday is end of next week", () => {
      expect(computeUrgency(new Date("2026-03-22"), "week", null, NOW)).toBe("next_week");
    });

    it("overdue when stored Sunday is in the past", () => {
      expect(computeUrgency(new Date("2026-03-08"), "week", null, NOW)).toBe("overdue");
    });

    it("later when stored Sunday is far out", () => {
      expect(computeUrgency(new Date("2026-04-05"), "week", null, NOW)).toBe("later");
    });
  });

  describe("no due date", () => {
    it("later when not completed", () => {
      expect(computeUrgency(null, null, null, NOW)).toBe("later");
    });

    it("done when completed", () => {
      expect(computeUrgency(null, null, new Date("2026-03-12"), NOW)).toBe("done");
    });
  });

  describe("completed items with due dates", () => {
    it("overdue for completed item due in the past", () => {
      expect(computeUrgency(new Date("2026-03-10"), "day", new Date("2026-03-12"), NOW)).toBe("overdue");
    });

    it("today for completed item due today", () => {
      expect(computeUrgency(new Date("2026-03-13"), "day", new Date("2026-03-13"), NOW)).toBe("today");
    });

    it("this_week for completed week-precision item", () => {
      expect(computeUrgency(new Date("2026-03-15"), "week", new Date("2026-03-13"), NOW)).toBe("this_week");
    });
  });

  describe("week boundaries from different days", () => {
    const SUNDAY = new Date("2026-03-15T12:00:00Z");
    const SATURDAY = new Date("2026-03-14T12:00:00Z");
    const MONDAY = new Date("2026-03-16T12:00:00Z");

    it("on Sunday, today is 'today'", () => {
      expect(computeUrgency(new Date("2026-03-15"), "day", null, SUNDAY)).toBe("today");
    });

    it("on Sunday, Monday is 'this_week' (upcoming week)", () => {
      expect(computeUrgency(new Date("2026-03-16"), "day", null, SUNDAY)).toBe("this_week");
    });

    it("on Sunday, next Sunday is 'this_week'", () => {
      expect(computeUrgency(new Date("2026-03-22"), "day", null, SUNDAY)).toBe("this_week");
    });

    it("on Sunday, Monday after next is 'next_week'", () => {
      expect(computeUrgency(new Date("2026-03-23"), "day", null, SUNDAY)).toBe("next_week");
    });

    it("on Saturday, Sunday (tomorrow) is 'this_week'", () => {
      expect(computeUrgency(new Date("2026-03-15"), "day", null, SATURDAY)).toBe("this_week");
    });

    it("on Saturday, next Monday is 'next_week'", () => {
      expect(computeUrgency(new Date("2026-03-16"), "day", null, SATURDAY)).toBe("next_week");
    });

    it("on Monday, this Sunday is 'this_week'", () => {
      expect(computeUrgency(new Date("2026-03-22"), "day", null, MONDAY)).toBe("this_week");
    });

    it("on Monday, next Monday is 'next_week'", () => {
      expect(computeUrgency(new Date("2026-03-23"), "day", null, MONDAY)).toBe("next_week");
    });

    it("on Monday, two Mondays out is 'later'", () => {
      expect(computeUrgency(new Date("2026-03-30"), "day", null, MONDAY)).toBe("later");
    });
  });

  describe("null precision treated as day-precision", () => {
    it("today with null precision", () => {
      expect(computeUrgency(new Date("2026-03-13"), null, null, NOW)).toBe("today");
    });

    it("overdue with null precision", () => {
      expect(computeUrgency(new Date("2026-03-10"), null, null, NOW)).toBe("overdue");
    });
  });
});

// ── computeDueDateLabel ──

describe("computeDueDateLabel", () => {
  describe("day-precision", () => {
    it("returns undefined for null dueDate", () => {
      expect(computeDueDateLabel(null, null, NOW)).toBeUndefined();
    });

    it("Today for today", () => {
      expect(computeDueDateLabel(new Date("2026-03-13"), "day", NOW)).toBe("Today");
    });

    it("Tomorrow for tomorrow", () => {
      expect(computeDueDateLabel(new Date("2026-03-14"), "day", NOW)).toBe("Tomorrow");
    });

    it("1 day ago for yesterday", () => {
      expect(computeDueDateLabel(new Date("2026-03-12"), "day", NOW)).toBe("1 day ago");
    });

    it("N days ago for past dates", () => {
      expect(computeDueDateLabel(new Date("2026-03-10"), "day", NOW)).toBe("3 days ago");
    });

    it("short day name within the week", () => {
      expect(computeDueDateLabel(new Date("2026-03-16"), "day", NOW)).toBe("Mon");
    });

    it("month+day for dates more than 6 days out", () => {
      expect(computeDueDateLabel(new Date("2026-03-25"), "day", NOW)).toBe("Mar 25");
    });
  });

  describe("week-precision", () => {
    it("This Week for current week", () => {
      expect(computeDueDateLabel(new Date("2026-03-15"), "week", NOW)).toBe("This Week");
    });

    it("Next Week for next week", () => {
      expect(computeDueDateLabel(new Date("2026-03-22"), "week", NOW)).toBe("Next Week");
    });

    it("Overdue for past week", () => {
      expect(computeDueDateLabel(new Date("2026-03-08"), "week", NOW)).toBe("Overdue");
    });
  });
});

// ── computeTriageResult ──

describe("computeTriageResult", () => {
  describe("precision", () => {
    it("today → day precision", () => {
      expect(computeTriageResult("today", NOW).dueDatePrecision).toBe("day");
    });

    it("tomorrow → day precision", () => {
      expect(computeTriageResult("tomorrow", NOW).dueDatePrecision).toBe("day");
    });

    it("this_week → week precision", () => {
      expect(computeTriageResult("this_week", NOW).dueDatePrecision).toBe("week");
    });

    it("next_week → week precision", () => {
      expect(computeTriageResult("next_week", NOW).dueDatePrecision).toBe("week");
    });

    it("next_month → day precision", () => {
      expect(computeTriageResult("next_month", NOW).dueDatePrecision).toBe("day");
    });
  });

  describe("dates from Friday (March 13)", () => {
    it("today → March 13", () => {
      expect(computeTriageResult("today", NOW).dueDate).toBe("2026-03-13T00:00:00.000Z");
    });

    it("tomorrow → March 14", () => {
      expect(computeTriageResult("tomorrow", NOW).dueDate).toBe("2026-03-14T00:00:00.000Z");
    });

    it("this_week → Sunday March 15", () => {
      expect(computeTriageResult("this_week", NOW).dueDate).toBe("2026-03-15T00:00:00.000Z");
    });

    it("next_week → Sunday March 22", () => {
      expect(computeTriageResult("next_week", NOW).dueDate).toBe("2026-03-22T00:00:00.000Z");
    });

    it("next_month → April 1", () => {
      expect(computeTriageResult("next_month", NOW).dueDate).toBe("2026-04-01T00:00:00.000Z");
    });
  });

  describe("Sunday edge cases (March 15)", () => {
    const SUNDAY = new Date("2026-03-15T12:00:00Z");

    it("this_week → NEXT Sunday (March 22)", () => {
      expect(computeTriageResult("this_week", SUNDAY).dueDate).toBe("2026-03-22T00:00:00.000Z");
    });

    it("next_week → Sunday March 29", () => {
      expect(computeTriageResult("next_week", SUNDAY).dueDate).toBe("2026-03-29T00:00:00.000Z");
    });
  });

  describe("other days", () => {
    const MONDAY = new Date("2026-03-16T12:00:00Z");
    const SATURDAY = new Date("2026-03-14T12:00:00Z");

    it("this_week on Monday → Sunday March 22", () => {
      expect(computeTriageResult("this_week", MONDAY).dueDate).toBe("2026-03-22T00:00:00.000Z");
    });

    it("this_week on Saturday → Sunday March 15", () => {
      expect(computeTriageResult("this_week", SATURDAY).dueDate).toBe("2026-03-15T00:00:00.000Z");
    });
  });
});

// ── triage → urgency round-trip ──

describe("triage → urgency round-trip", () => {
  function triageAndClassify(
    preset: "today" | "tomorrow" | "this_week" | "next_week" | "next_month",
    now: Date
  ): Urgency {
    const result = computeTriageResult(preset, now);
    return computeUrgency(new Date(result.dueDate), result.dueDatePrecision, null, now);
  }

  describe("from Friday (March 13)", () => {
    it("today → 'today'", () => expect(triageAndClassify("today", NOW)).toBe("today"));
    it("tomorrow → 'this_week'", () => expect(triageAndClassify("tomorrow", NOW)).toBe("this_week"));
    it("this_week → 'this_week'", () => expect(triageAndClassify("this_week", NOW)).toBe("this_week"));
    it("next_week → 'next_week'", () => expect(triageAndClassify("next_week", NOW)).toBe("next_week"));
    it("next_month → 'later'", () => expect(triageAndClassify("next_month", NOW)).toBe("later"));
  });

  describe("from Sunday (March 15)", () => {
    const SUNDAY = new Date("2026-03-15T12:00:00Z");

    it("today → 'today'", () => expect(triageAndClassify("today", SUNDAY)).toBe("today"));
    it("this_week → 'this_week'", () => expect(triageAndClassify("this_week", SUNDAY)).toBe("this_week"));
    it("next_week → 'next_week'", () => expect(triageAndClassify("next_week", SUNDAY)).toBe("next_week"));
  });

  describe("from Monday (March 16)", () => {
    const MONDAY = new Date("2026-03-16T12:00:00Z");

    it("today → 'today'", () => expect(triageAndClassify("today", MONDAY)).toBe("today"));
    it("this_week → 'this_week'", () => expect(triageAndClassify("this_week", MONDAY)).toBe("this_week"));
    it("next_week → 'next_week'", () => expect(triageAndClassify("next_week", MONDAY)).toBe("next_week"));
  });

  describe("from Saturday (March 14)", () => {
    const SATURDAY = new Date("2026-03-14T12:00:00Z");

    it("this_week → 'this_week'", () => expect(triageAndClassify("this_week", SATURDAY)).toBe("this_week"));
    it("next_week → 'next_week'", () => expect(triageAndClassify("next_week", SATURDAY)).toBe("next_week"));
  });
});

// ── triage → label round-trip ──

describe("triage → label round-trip", () => {
  function triageAndLabel(
    preset: "today" | "tomorrow" | "this_week" | "next_week" | "next_month",
    now: Date
  ): string | undefined {
    const result = computeTriageResult(preset, now);
    return computeDueDateLabel(new Date(result.dueDate), result.dueDatePrecision, now);
  }

  it("today → 'Today'", () => expect(triageAndLabel("today", NOW)).toBe("Today"));
  it("tomorrow → 'Tomorrow'", () => expect(triageAndLabel("tomorrow", NOW)).toBe("Tomorrow"));
  it("this_week → 'This Week'", () => expect(triageAndLabel("this_week", NOW)).toBe("This Week"));
  it("next_week → 'Next Week'", () => expect(triageAndLabel("next_week", NOW)).toBe("Next Week"));
  it("next_month → 'Apr 1'", () => expect(triageAndLabel("next_month", NOW)).toBe("Apr 1"));
});

// ── today view filtering ──

describe("today view filtering", () => {
  const TODAY_VIEW_URGENCIES = new Set(["overdue", "today", "this_week"]);

  function isVisibleInTodayView(urgency: Urgency): boolean {
    return TODAY_VIEW_URGENCIES.has(urgency);
  }

  it("shows overdue", () => expect(isVisibleInTodayView("overdue")).toBe(true));
  it("shows today", () => expect(isVisibleInTodayView("today")).toBe(true));
  it("shows this_week", () => expect(isVisibleInTodayView("this_week")).toBe(true));
  it("hides next_week", () => expect(isVisibleInTodayView("next_week")).toBe(false));
  it("hides later", () => expect(isVisibleInTodayView("later")).toBe(false));
  it("hides done", () => expect(isVisibleInTodayView("done")).toBe(false));

  describe("triage from today view", () => {
    const MONDAY = new Date("2026-03-16T12:00:00Z");

    it("'today' stays visible", () => {
      const r = computeTriageResult("today", MONDAY);
      expect(isVisibleInTodayView(computeUrgency(new Date(r.dueDate), r.dueDatePrecision, null, MONDAY))).toBe(true);
    });

    it("'this_week' stays visible", () => {
      const r = computeTriageResult("this_week", MONDAY);
      expect(isVisibleInTodayView(computeUrgency(new Date(r.dueDate), r.dueDatePrecision, null, MONDAY))).toBe(true);
    });

    it("'next_week' leaves view", () => {
      const r = computeTriageResult("next_week", MONDAY);
      expect(isVisibleInTodayView(computeUrgency(new Date(r.dueDate), r.dueDatePrecision, null, MONDAY))).toBe(false);
    });
  });
});

// ── computeStalenessDays ──

describe("computeStalenessDays", () => {
  it("undefined when updated recently", () => expect(computeStalenessDays(new Date("2026-03-12"), NOW)).toBeUndefined());
  it("returns day count when stale", () => expect(computeStalenessDays(new Date("2026-03-09"), NOW)).toBe(4));
  it("returns 2 at the threshold", () => expect(computeStalenessDays(new Date("2026-03-11T12:00:00Z"), NOW)).toBe(2));
});

// ── itemToThing ──

describe("itemToThing", () => {
  it("transforms a day-precision item", () => {
    const item = makeItem({ dueDate: new Date("2026-03-13"), dueDatePrecision: "day" });
    const thing = itemToThing(item, NOW);

    expect(thing.urgency).toBe("today");
    expect(thing.dueDateLabel).toBe("Today");
    expect(thing.dueDatePrecision).toBe("day");
  });

  it("transforms a week-precision item", () => {
    const item = makeItem({ dueDate: new Date("2026-03-15"), dueDatePrecision: "week" });
    const thing = itemToThing(item, NOW);

    expect(thing.urgency).toBe("this_week");
    expect(thing.dueDateLabel).toBe("This Week");
    expect(thing.dueDatePrecision).toBe("week");
  });

  it("completed item without due date is done", () => {
    const item = makeItem({ completedAt: new Date("2026-03-12") });
    const thing = itemToThing(item, NOW);

    expect(thing.isCompleted).toBe(true);
    expect(thing.urgency).toBe("done");
  });

  it("completed day-precision item keeps date-based urgency", () => {
    const item = makeItem({ dueDate: new Date("2026-03-13"), dueDatePrecision: "day", completedAt: new Date("2026-03-13") });
    const thing = itemToThing(item, NOW);

    expect(thing.isCompleted).toBe(true);
    expect(thing.urgency).toBe("today");
  });

  it("no dueDate gets 'later' urgency", () => {
    const thing = itemToThing(makeItem(), NOW);
    expect(thing.urgency).toBe("later");
    expect(thing.dueDatePrecision).toBeUndefined();
  });

  it("includes dueDate as ISO string", () => {
    const item = makeItem({ dueDate: new Date("2026-03-15T00:00:00.000Z"), dueDatePrecision: "day" });
    expect(itemToThing(item, NOW).dueDate).toBe("2026-03-15T00:00:00.000Z");
  });

  it("dueDate is undefined when null", () => {
    expect(itemToThing(makeItem(), NOW).dueDate).toBeUndefined();
  });
});

// ── validateCreateItem ──

describe("validateCreateItem", () => {
  const validInput = { type: "task", title: "My task", listId: "list-1" };

  it("accepts valid input", () => expect(validateCreateItem(validInput).ok).toBe(true));
  it("rejects missing title", () => expect(validateCreateItem({ ...validInput, title: "" }).ok).toBe(false));
  it("rejects missing type", () => expect(validateCreateItem({ ...validInput, type: undefined }).ok).toBe(false));
  it("rejects invalid type", () => expect(validateCreateItem({ ...validInput, type: "banana" }).ok).toBe(false));
  it("accepts content type", () => expect(validateCreateItem({ ...validInput, type: "content" }).ok).toBe(true));
  it("rejects invalid status", () => expect(validateCreateItem({ ...validInput, status: "nope" }).ok).toBe(false));
  it("rejects invalid dueDate", () => expect(validateCreateItem({ ...validInput, dueDate: "not-a-date" }).ok).toBe(false));
  it("rejects null body", () => expect(validateCreateItem(null).ok).toBe(false));

  it("accepts dueDatePrecision", () => {
    const result = validateCreateItem({ ...validInput, dueDate: "2026-03-15T00:00:00Z", dueDatePrecision: "week" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.dueDatePrecision).toBe("week");
  });

  it("rejects invalid dueDatePrecision", () => {
    const result = validateCreateItem({ ...validInput, dueDatePrecision: "month" });
    expect(result.ok).toBe(false);
  });
});

// ── validateBulkUpdate ──

describe("validateBulkUpdate", () => {
  it("accepts valid bulk update", () => {
    expect(validateBulkUpdate({ ids: ["id-1"], updates: { listId: "list-1" } }).ok).toBe(true);
  });

  it("accepts dueDatePrecision in updates", () => {
    const result = validateBulkUpdate({
      ids: ["id-1"],
      updates: { dueDate: "2026-03-15T00:00:00Z", dueDatePrecision: "week" },
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.updates.dueDatePrecision).toBe("week");
  });

  it("rejects invalid dueDatePrecision", () => {
    expect(validateBulkUpdate({ ids: ["id-1"], updates: { dueDatePrecision: "month" } }).ok).toBe(false);
  });

  it("rejects empty ids", () => expect(validateBulkUpdate({ ids: [], updates: { listId: "x" } }).ok).toBe(false));
  it("rejects more than 100 ids", () => {
    const ids = Array.from({ length: 101 }, (_, i) => `id-${i}`);
    expect(validateBulkUpdate({ ids, updates: { listId: "x" } }).ok).toBe(false);
  });
  it("rejects null body", () => expect(validateBulkUpdate(null).ok).toBe(false));
});

// ── computeRelativeAge ──

describe("computeRelativeAge", () => {
  it("just now", () => expect(computeRelativeAge(new Date(NOW.getTime() - 30_000), NOW)).toBe("just now"));
  it("minutes", () => expect(computeRelativeAge(new Date(NOW.getTime() - 25 * 60_000), NOW)).toBe("25m ago"));
  it("hours", () => expect(computeRelativeAge(new Date(NOW.getTime() - 5 * 3600_000), NOW)).toBe("5h ago"));
  it("days", () => expect(computeRelativeAge(new Date(NOW.getTime() - 3 * 86400_000), NOW)).toBe("3d ago"));
});

// ── validateCreateList ──

describe("validateCreateList", () => {
  it("accepts valid", () => expect(validateCreateList({ name: "Work" }).ok).toBe(true));
  it("rejects empty", () => expect(validateCreateList({ name: "  " }).ok).toBe(false));
  it("trims", () => {
    const r = validateCreateList({ name: "  Work  " });
    if (r.ok) expect(r.data.name).toBe("Work");
  });
  it("rejects null", () => expect(validateCreateList(null).ok).toBe(false));
});

// ── validateCreateList extended ──

describe("validateCreateList extended", () => {
  it("accepts a valid colorClass from the allowlist", () => {
    const result = validateCreateList({ name: "Test", colorClass: "bg-blue-400" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.colorClass).toBe("bg-blue-400");
  });

  it("silently ignores an invalid colorClass", () => {
    const result = validateCreateList({ name: "Test", colorClass: "bg-evil-500" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.colorClass).toBeUndefined();
  });

  it("rejects name longer than 100 characters", () => {
    const result = validateCreateList({ name: "a".repeat(101) });
    expect(result.ok).toBe(false);
  });

  it("accepts name exactly 100 characters", () => {
    const result = validateCreateList({ name: "a".repeat(100) });
    expect(result.ok).toBe(true);
  });
});

// ── validateUpdateList ──

describe("validateUpdateList", () => {
  it("accepts valid name update", () => {
    const result = validateUpdateList({ name: "New Name" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.name).toBe("New Name");
  });

  it("accepts valid colorClass update", () => {
    const result = validateUpdateList({ colorClass: "bg-emerald-400" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.colorClass).toBe("bg-emerald-400");
  });

  it("rejects invalid colorClass with error", () => {
    const result = validateUpdateList({ colorClass: "bg-evil-500" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("invalid colorClass");
  });

  it("rejects name longer than 100 characters", () => {
    const result = validateUpdateList({ name: "a".repeat(101) });
    expect(result.ok).toBe(false);
  });

  it("rejects empty name", () => {
    const result = validateUpdateList({ name: "" });
    expect(result.ok).toBe(false);
  });

  it("accepts colorClass-only update (name undefined)", () => {
    const result = validateUpdateList({ colorClass: "bg-blue-400" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.name).toBeUndefined();
      expect(result.data.colorClass).toBe("bg-blue-400");
    }
  });

  it("rejects null body", () => {
    const result = validateUpdateList(null);
    expect(result.ok).toBe(false);
  });
});

// ── groupUpcomingThings ──

describe("groupUpcomingThings", () => {
  // NOW is Friday March 13, 2026
  // Next 7 days: Sat 14, Sun 15, Mon 16, Tue 17, Wed 18, Thu 19, Fri 20
  // This week's Sunday: March 15
  // Next week's Sunday: March 22

  function makeThing(overrides: Partial<Thing> = {}): Thing {
    return {
      id: "t-" + Math.random().toString(36).slice(2),
      type: "task",
      title: "Test",
      list: "Inbox",
      listId: null,
      status: "active",
      source: "Brett",
      urgency: "later",
      isCompleted: false,
      ...overrides,
    };
  }

  it("returns empty array for empty input", () => {
    expect(groupUpcomingThings([], NOW)).toEqual([]);
  });

  it("groups day-precision items into per-day sections for next 7 days", () => {
    const things = [
      makeThing({ title: "Sat task", dueDate: "2026-03-14T00:00:00Z", dueDatePrecision: "day" }),
      makeThing({ title: "Mon task", dueDate: "2026-03-16T00:00:00Z", dueDatePrecision: "day" }),
    ];
    const sections = groupUpcomingThings(things, NOW);
    expect(sections[0].label).toBe("Tomorrow");
    expect(sections[0].things[0].title).toBe("Sat task");
    expect(sections[1].label).toBe("Monday");
    expect(sections[1].things[0].title).toBe("Mon task");
  });

  it("groups week-precision items into This Week / Next Week", () => {
    const things = [
      makeThing({ title: "This wk", dueDate: "2026-03-15T00:00:00Z", dueDatePrecision: "week" }),
      makeThing({ title: "Next wk", dueDate: "2026-03-22T00:00:00Z", dueDatePrecision: "week" }),
    ];
    const sections = groupUpcomingThings(things, NOW);
    expect(sections.find((s) => s.label === "This Week")?.things[0].title).toBe("This wk");
    expect(sections.find((s) => s.label === "Next Week")?.things[0].title).toBe("Next wk");
  });

  it("groups far-future items into weekly ranges", () => {
    const things = [
      makeThing({ title: "Far out", dueDate: "2026-04-01T00:00:00Z", dueDatePrecision: "day" }),
    ];
    const sections = groupUpcomingThings(things, NOW);
    const last = sections[sections.length - 1];
    expect(last.label).toMatch(/Mar 30.*Apr 5/);
    expect(last.things[0].title).toBe("Far out");
  });

  it("sections are chronologically ordered", () => {
    const things = [
      makeThing({ title: "Next wk", dueDate: "2026-03-22T00:00:00Z", dueDatePrecision: "week" }),
      makeThing({ title: "Tomorrow", dueDate: "2026-03-14T00:00:00Z", dueDatePrecision: "day" }),
      makeThing({ title: "This wk", dueDate: "2026-03-15T00:00:00Z", dueDatePrecision: "week" }),
    ];
    const sections = groupUpcomingThings(things, NOW);
    const labels = sections.map((s) => s.label);
    expect(labels.indexOf("Tomorrow")).toBeLessThan(labels.indexOf("This Week"));
    expect(labels.indexOf("This Week")).toBeLessThan(labels.indexOf("Next Week"));
  });

  it("does not include day-precision items in weekly ranges if within 7 days", () => {
    const things = [
      makeThing({ title: "Day item", dueDate: "2026-03-16T00:00:00Z", dueDatePrecision: "day" }),
    ];
    const sections = groupUpcomingThings(things, NOW);
    expect(sections.length).toBe(1);
    expect(sections[0].label).toBe("Monday");
  });

  it("items with no dueDate are excluded from all sections", () => {
    const things = [
      makeThing({ title: "No date", dueDate: undefined }),
      makeThing({ title: "Has date", dueDate: "2026-03-14T00:00:00Z", dueDatePrecision: "day" }),
    ];
    const sections = groupUpcomingThings(things, NOW);
    const allTitles = sections.flatMap((s) => s.things.map((t) => t.title));
    expect(allTitles).toContain("Has date");
    expect(allTitles).not.toContain("No date");
  });

  it("week-precision item beyond next week falls into future weekly range", () => {
    const things = [
      makeThing({ title: "Far week", dueDate: "2026-04-12T00:00:00Z", dueDatePrecision: "week" }),
    ];
    const sections = groupUpcomingThings(things, NOW);
    expect(sections.length).toBe(1);
    // Should be in a "Apr X – Y" range, not "This Week" or "Next Week"
    expect(sections[0].label).not.toBe("This Week");
    expect(sections[0].label).not.toBe("Next Week");
    expect(sections[0].label).toMatch(/Apr/);
  });
});
