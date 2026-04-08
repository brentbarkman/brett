// ────────────────────────────────────────────────────────────────────────────
// Mock Hooks — drop-in replacements for real hooks during UI prototyping
//
// Each hook mirrors the interface of its real counterpart so swapping to the
// production store hooks is a one-line import change per screen.
// ────────────────────────────────────────────────────────────────────────────

import { useState, useMemo, useCallback } from "react";
import {
  MOCK_ITEMS,
  MOCK_LISTS,
  MOCK_CALENDAR_EVENTS,
  MOCK_SCOUTS,
  MOCK_SCOUT_FINDINGS,
  MOCK_BRIEFING,
  MOCK_SUBTASKS,
  MOCK_USER_ID,
  getListForItem,
  type MockItem,
  type MockList,
  type MockCalendarEvent,
  type MockScout,
  type MockScoutFinding,
  type MockSubtask,
} from "./data";

// ── Types re-exported for callers ─────────────────────────────────────────────

export type { MockItem, MockList, MockCalendarEvent, MockScout, MockScoutFinding, MockSubtask };

/** List enriched with item counts — mirrors NavListView from useLists. */
export interface MockNavList extends MockList {
  count: number;
  completedCount: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function generateId(): string {
  return `mock-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Returns true if the date string is a future date (beyond today). */
function isFutureDate(dateStr: string): boolean {
  const d = new Date(dateStr);
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const startOfTomorrow = new Date(startOfToday);
  startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);
  return d >= startOfTomorrow;
}

/** Format meeting duration in "Xh Ym" form. */
function formatDuration(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

// ── useMockItems ──────────────────────────────────────────────────────────────

export function useMockItems() {
  const [items, setItems] = useState<MockItem[]>(MOCK_ITEMS);

  /** Today view: urgency items — active first, done at bottom. */
  const todayItems = useMemo(() => {
    return items
      .filter((item) => item.urgency !== null && (item.status === "active" || item.status === "done"))
      .sort((a, b) => {
        if (a.status === "done" && b.status !== "done") return 1;
        if (a.status !== "done" && b.status === "done") return -1;
        // Within active: overdue first, then today, then this_week
        const urgencyOrder = { overdue: 0, today: 1, this_week: 2, null: 3 };
        const aOrder = urgencyOrder[a.urgency ?? "null"] ?? 3;
        const bOrder = urgencyOrder[b.urgency ?? "null"] ?? 3;
        if (aOrder !== bOrder) return aOrder - bOrder;
        // Stable sort by id
        return a.id.localeCompare(b.id);
      });
  }, [items]);

  /** Inbox: no dueDate, no listId, active only. */
  const inboxItems = useMemo(() => {
    return items
      .filter((item) => !item.dueDate && !item.listId && item.status === "active")
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [items]);

  /** Upcoming: future-dated active items, sorted ascending by date. */
  const upcomingItems = useMemo(() => {
    return items
      .filter((item) => item.dueDate && isFutureDate(item.dueDate) && item.status === "active")
      .sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? ""));
  }, [items]);

  /** Items for a specific list. */
  const getListItems = useCallback(
    (listId: string): MockItem[] => {
      return items
        .filter((item) => item.listId === listId && item.status !== "archived")
        .sort((a, b) => {
          if (a.status === "done" && b.status !== "done") return 1;
          if (a.status !== "done" && b.status === "done") return -1;
          return b.createdAt.localeCompare(a.createdAt);
        });
    },
    [items],
  );

  /** Get a single item by id. */
  const getItem = useCallback(
    (id: string): MockItem | undefined => items.find((item) => item.id === id),
    [items],
  );

  /** Toggle an item between active and done. */
  const toggleItem = useCallback((id: string) => {
    setItems((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;
        const newStatus = item.status === "done" ? "active" : "done";
        return {
          ...item,
          status: newStatus,
          completedAt: newStatus === "done" ? new Date().toISOString() : null,
          updatedAt: new Date().toISOString(),
        };
      }),
    );
  }, []);

  /** Create a new item. */
  const createItem = useCallback(
    (title: string, dueDate?: string | null, listId?: string | null): string => {
      const id = generateId();
      const now = new Date().toISOString();
      const newItem: MockItem = {
        id,
        type: "task",
        status: "active",
        title,
        description: null,
        notes: null,
        dueDate: dueDate ?? null,
        completedAt: null,
        reminder: null,
        recurrence: null,
        recurrenceRule: null,
        contentType: null,
        contentDomain: null,
        contentDescription: null,
        listId: listId ?? null,
        userId: MOCK_USER_ID,
        createdAt: now,
        updatedAt: now,
        urgency: null,
      };
      setItems((prev) => [newItem, ...prev]);
      return id;
    },
    [],
  );

  /** Delete an item by id. */
  const deleteItem = useCallback((id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  }, []);

  return {
    items,
    todayItems,
    inboxItems,
    upcomingItems,
    getListItems,
    getItem,
    toggleItem,
    createItem,
    deleteItem,
  };
}

// ── useMockLists ──────────────────────────────────────────────────────────────

export function useMockLists() {
  const [lists] = useState<MockList[]>(MOCK_LISTS);
  const [items] = useState<MockItem[]>(MOCK_ITEMS);

  /** Lists enriched with active + done item counts. */
  const navLists: MockNavList[] = useMemo(() => {
    const countsByList = new Map<string, { active: number; done: number }>();
    for (const item of items) {
      if (!item.listId) continue;
      const counts = countsByList.get(item.listId) ?? { active: 0, done: 0 };
      if (item.status === "done") counts.done++;
      else if (item.status === "active") counts.active++;
      countsByList.set(item.listId, counts);
    }

    return lists
      .filter((l) => !l.archivedAt)
      .map((l) => {
        const counts = countsByList.get(l.id) ?? { active: 0, done: 0 };
        return { ...l, count: counts.active, completedCount: counts.done };
      });
  }, [lists, items]);

  const getList = useCallback(
    (id: string): MockList | undefined => lists.find((l) => l.id === id),
    [lists],
  );

  return { lists, navLists, getList };
}

// ── useMockCalendarEvents ─────────────────────────────────────────────────────

export function useMockCalendarEvents() {
  const [events] = useState<MockCalendarEvent[]>(MOCK_CALENDAR_EVENTS);

  /** Non-all-day events for today. */
  const todayEvents = useMemo(
    () => events.filter((e) => !e.isAllDay),
    [events],
  );

  /** The next upcoming non-all-day event that hasn't ended yet. */
  const nextEvent = useMemo((): MockCalendarEvent | null => {
    const now = new Date();
    return (
      todayEvents
        .filter((e) => new Date(e.endTime) > now)
        .sort((a, b) => a.startTime.localeCompare(b.startTime))[0] ?? null
    );
  }, [todayEvents]);

  /** Total meeting time summary for today. */
  const meetingStats = useMemo(() => {
    const count = todayEvents.length;
    const totalMinutes = todayEvents.reduce((sum, e) => {
      const diffMs = new Date(e.endTime).getTime() - new Date(e.startTime).getTime();
      return sum + Math.round(diffMs / 60_000);
    }, 0);
    return { count, duration: formatDuration(totalMinutes) };
  }, [todayEvents]);

  return { events, todayEvents, nextEvent, meetingStats };
}

// ── useMockScouts ─────────────────────────────────────────────────────────────

export function useMockScouts() {
  const [scouts] = useState<MockScout[]>(MOCK_SCOUTS);
  const [findings] = useState<MockScoutFinding[]>(MOCK_SCOUT_FINDINGS);

  const getScout = useCallback(
    (id: string): MockScout | undefined => scouts.find((s) => s.id === id),
    [scouts],
  );

  const getFindings = useCallback(
    (scoutId: string): MockScoutFinding[] =>
      findings.filter((f) => f.scoutId === scoutId),
    [findings],
  );

  return { scouts, getScout, getFindings };
}

// ── useMockBriefing ───────────────────────────────────────────────────────────

export function useMockBriefing() {
  const [isDismissed, setIsDismissed] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);

  const dismiss = useCallback(() => setIsDismissed(true), []);
  const toggleCollapse = useCallback(() => setIsCollapsed((v) => !v), []);

  return {
    content: MOCK_BRIEFING.content,
    generatedAt: MOCK_BRIEFING.generatedAt,
    isGenerating: false,
    isDismissed,
    isCollapsed,
    dismiss,
    toggleCollapse,
  };
}

// ── useMockSubtasks ───────────────────────────────────────────────────────────

export function useMockSubtasks(itemId: string) {
  const initial = MOCK_SUBTASKS[itemId] ?? [];
  const [subtasks, setSubtasks] = useState<MockSubtask[]>(initial);

  const toggleSubtask = useCallback((subId: string) => {
    setSubtasks((prev) =>
      prev.map((s) => (s.id === subId ? { ...s, done: !s.done } : s)),
    );
  }, []);

  return { subtasks, toggleSubtask };
}

// ── useTodayStats ─────────────────────────────────────────────────────────────

export function useTodayStats() {
  const { todayItems } = useMockItems();
  const { meetingStats } = useMockCalendarEvents();

  const totalToday = useMemo(
    () => todayItems.filter((i) => i.status === "active").length,
    [todayItems],
  );

  const doneToday = useMemo(
    () => todayItems.filter((i) => i.status === "done").length,
    [todayItems],
  );

  return {
    totalToday,
    doneToday,
    meetingCount: meetingStats.count,
    meetingDuration: meetingStats.duration,
  };
}
