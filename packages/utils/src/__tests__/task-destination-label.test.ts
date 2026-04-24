import { describe, it, expect } from "vitest";
import type { NavList } from "@brett/types";
import { getTaskDestinationLabel } from "../index";

const list = (id: string, name: string): NavList => ({
  id,
  name,
  count: 0,
  completedCount: 0,
  colorClass: "",
  sortOrder: 0,
});

describe("getTaskDestinationLabel", () => {
  const lists: NavList[] = [
    list("abc123", "Shopping"),
    list("def456", "Work"),
  ];

  it("returns Inbox when currentView is undefined", () => {
    expect(getTaskDestinationLabel(undefined, lists)).toBe("Inbox");
  });

  it("returns Inbox for the inbox view", () => {
    expect(getTaskDestinationLabel("inbox", lists)).toBe("Inbox");
  });

  it("returns Today for the today view (matches dueDate=today behavior in createTask)", () => {
    expect(getTaskDestinationLabel("today", lists)).toBe("Today");
  });

  it("returns the list name for a list: view when the id is known", () => {
    expect(getTaskDestinationLabel("list:abc123", lists)).toBe("Shopping");
    expect(getTaskDestinationLabel("list:def456", lists)).toBe("Work");
  });

  it("falls back to Inbox when list id cannot be resolved", () => {
    expect(getTaskDestinationLabel("list:unknown", lists)).toBe("Inbox");
    expect(getTaskDestinationLabel("list:abc123", [])).toBe("Inbox");
  });

  it("returns Inbox for views that createTask doesn't specialize (upcoming, calendar, scouts, settings)", () => {
    // These views fall through createTask's defaults → the task lands in the inbox.
    // The label must reflect where the task actually goes, not which screen the user is on.
    expect(getTaskDestinationLabel("upcoming", lists)).toBe("Inbox");
    expect(getTaskDestinationLabel("calendar", lists)).toBe("Inbox");
    expect(getTaskDestinationLabel("scouts", lists)).toBe("Inbox");
    expect(getTaskDestinationLabel("settings", lists)).toBe("Inbox");
  });

  it("handles a malformed list: view with no id", () => {
    expect(getTaskDestinationLabel("list:", lists)).toBe("Inbox");
  });
});
