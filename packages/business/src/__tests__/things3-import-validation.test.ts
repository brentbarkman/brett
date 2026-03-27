import { describe, it, expect } from "vitest";
import { validateThings3Import } from "../index";

describe("validateThings3Import", () => {
  it("accepts a valid payload", () => {
    const result = validateThings3Import({
      lists: [{ name: "Work", thingsUuid: "abc-123" }],
      tasks: [
        { title: "Buy milk", status: "active" },
        {
          title: "Old task",
          status: "done",
          completedAt: "2024-01-15T10:00:00.000Z",
          thingsProjectUuid: "abc-123",
        },
      ],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.lists).toHaveLength(1);
      expect(result.data.tasks).toHaveLength(2);
    }
  });

  it("rejects missing body", () => {
    const result = validateThings3Import(null);
    expect(result.ok).toBe(false);
  });

  it("rejects non-array lists", () => {
    const result = validateThings3Import({ lists: "nope", tasks: [] });
    expect(result.ok).toBe(false);
  });

  it("rejects non-array tasks", () => {
    const result = validateThings3Import({ lists: [], tasks: "nope" });
    expect(result.ok).toBe(false);
  });

  it("rejects list with empty name", () => {
    const result = validateThings3Import({
      lists: [{ name: "", thingsUuid: "abc" }],
      tasks: [],
    });
    expect(result.ok).toBe(false);
  });

  it("rejects list with missing thingsUuid", () => {
    const result = validateThings3Import({
      lists: [{ name: "Work" }],
      tasks: [],
    });
    expect(result.ok).toBe(false);
  });

  it("rejects task with empty title", () => {
    const result = validateThings3Import({
      lists: [],
      tasks: [{ title: "", status: "active" }],
    });
    expect(result.ok).toBe(false);
  });

  it("rejects task with invalid status", () => {
    const result = validateThings3Import({
      lists: [],
      tasks: [{ title: "Test", status: "pending" }],
    });
    expect(result.ok).toBe(false);
  });

  it("rejects payload exceeding 10,000 tasks", () => {
    const tasks = Array.from({ length: 10_001 }, (_, i) => ({
      title: `Task ${i}`,
      status: "active" as const,
    }));
    const result = validateThings3Import({ lists: [], tasks });
    expect(result.ok).toBe(false);
  });

  it("truncates list name at 100 chars", () => {
    const result = validateThings3Import({
      lists: [{ name: "A".repeat(150), thingsUuid: "abc" }],
      tasks: [],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.lists[0].name.length).toBe(100);
    }
  });

  it("truncates task title at 500 chars", () => {
    const result = validateThings3Import({
      lists: [],
      tasks: [{ title: "A".repeat(600), status: "active" }],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.tasks[0].title.length).toBe(500);
    }
  });

  it("skips tasks with empty title after trim", () => {
    const result = validateThings3Import({
      lists: [],
      tasks: [
        { title: "   ", status: "active" },
        { title: "Valid task", status: "active" },
      ],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.tasks).toHaveLength(1);
      expect(result.data.tasks[0].title).toBe("Valid task");
    }
  });

  it("validates dueDate format", () => {
    const result = validateThings3Import({
      lists: [],
      tasks: [{ title: "Test", status: "active", dueDate: "not-a-date" }],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.tasks[0].dueDate).toBeUndefined();
    }
  });

  it("validates completedAt format", () => {
    const result = validateThings3Import({
      lists: [],
      tasks: [{ title: "Test", status: "done", completedAt: "bad" }],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.tasks[0].completedAt).toBeUndefined();
    }
  });

  it("rejects payload exceeding 500 lists", () => {
    const lists = Array.from({ length: 501 }, (_, i) => ({
      name: `List ${i}`,
      thingsUuid: `uuid-${i}`,
    }));
    const result = validateThings3Import({ lists, tasks: [] });
    expect(result.ok).toBe(false);
  });

  it("validates createdAt format", () => {
    const result = validateThings3Import({
      lists: [],
      tasks: [{ title: "Test", status: "active", createdAt: "not-a-date" }],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.tasks[0].createdAt).toBeUndefined();
    }
  });
});
