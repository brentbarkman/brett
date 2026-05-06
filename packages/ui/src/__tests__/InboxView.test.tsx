import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { Thing, NavList } from "@brett/types";
import { InboxView } from "../InboxView";

function setVisibility(state: "visible" | "hidden"): void {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

function makeThing(id: string, title: string, createdAt?: string): Thing {
  return {
    id,
    type: "task",
    title,
    list: "Inbox",
    listId: null,
    status: "active",
    source: "manual",
    urgency: "later",
    isCompleted: false,
    createdAt: createdAt ?? new Date().toISOString(),
  };
}

function renderInbox(things: Thing[]) {
  const lists: NavList[] = [];
  return render(
    <InboxView
      things={things}
      lists={lists}
      onItemClick={vi.fn()}
      onToggle={vi.fn()}
      onArchive={vi.fn()}
      onAdd={vi.fn()}
      onTriage={vi.fn()}
    />,
  );
}

describe("InboxView empty state", () => {
  it("shows first-time copy when the inbox has never had items this session", () => {
    renderInbox([]);
    expect(screen.getByText(/Your inbox is ready/i)).toBeInTheDocument();
    // Must NOT mislead a first-time user with 'caught up' framing.
    expect(screen.queryByText(/Caught up/i)).not.toBeInTheDocument();
  });

  it("switches to caught-up copy after the user has cleared previously-present items", () => {
    const { rerender } = renderInbox([makeThing("a", "something")]);
    // Sanity: the item is visible, no empty state yet
    expect(screen.getByText("something")).toBeInTheDocument();

    rerender(
      <InboxView
        things={[]}
        lists={[]}
        onItemClick={vi.fn()}
        onToggle={vi.fn()}
        onArchive={vi.fn()}
        onAdd={vi.fn()}
        onTriage={vi.fn()}
      />,
    );

    expect(screen.getByText(/Caught up/i)).toBeInTheDocument();
    // First-time copy must NOT render once the user has proven they know the surface
    expect(screen.queryByText(/Your inbox is ready/i)).not.toBeInTheDocument();
  });
});

describe("InboxView keyboard shortcuts", () => {
  it("focuses the quick-add input when the user presses plain `n`", () => {
    renderInbox([]);
    const quickAdd = screen.getByPlaceholderText(/Add to inbox/i) as HTMLInputElement;
    expect(document.activeElement).not.toBe(quickAdd);

    act(() => {
      fireEvent.keyDown(document, { key: "n" });
    });

    expect(document.activeElement).toBe(quickAdd);
  });

  // Regression guard for issues #80/#81/#82: the InboxView `n` shortcut
  // used to match without checking modifiers, which meant cmd+n on the
  // inbox scrolled to and focused the quick-add input — shadowing the
  // global cmd+n shortcut that should open the Spotlight with create
  // preselected. This test prevents the category of bug where a
  // single-letter keyboard handler accidentally shadows a cmd+letter
  // global shortcut.
  it("does NOT focus the quick-add input when the user presses cmd+n (leaves it to the global shortcut)", () => {
    renderInbox([]);
    const quickAdd = screen.getByPlaceholderText(/Add to inbox/i) as HTMLInputElement;
    // Start with focus somewhere else to prove we didn't accidentally focus via the test setup
    (document.body as HTMLElement).focus();
    expect(document.activeElement).not.toBe(quickAdd);

    act(() => {
      fireEvent.keyDown(document, { key: "n", metaKey: true });
    });

    expect(document.activeElement).not.toBe(quickAdd);
  });

  it("does NOT focus the quick-add input when the user presses ctrl+n", () => {
    renderInbox([]);
    const quickAdd = screen.getByPlaceholderText(/Add to inbox/i) as HTMLInputElement;
    (document.body as HTMLElement).focus();

    act(() => {
      fireEvent.keyDown(document, { key: "n", ctrlKey: true });
    });

    expect(document.activeElement).not.toBe(quickAdd);
  });
});

/**
 * Regression test for the overnight bucket-staleness bug.
 *
 * History: InboxView captured `now` in a `useRef(new Date())` and updated
 * it inside a `useVisibilityAwareInterval` callback. Updating a ref
 * doesn't trigger a re-render, so the temporal-grouping logic
 * (`getTimeBucket`, `groupedDisplay`) only re-ran when something else
 * caused InboxView to render. If the desktop app stayed open past local
 * midnight, items created "earlier today" were still labeled "EARLIER
 * TODAY" instead of moving to "YESTERDAY" — the bucket headers and
 * grouped order didn't reflect the new day.
 *
 * Fix: drive `now` via the `useNow` state hook so each tick triggers a
 * re-render and the buckets recompute against the current clock.
 */
describe("InboxView temporal bucket rollover", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setVisibility("visible");
  });

  afterEach(() => {
    vi.useRealTimers();
    setVisibility("visible");
  });

  it("re-buckets an 'earlier today' item to 'yesterday' after local midnight passes", () => {
    // Pre-midnight: 2026-05-06 23:30 local. Item created at 2026-05-06 09:00.
    vi.setSystemTime(new Date("2026-05-06T23:30:00"));

    const earlierItem = makeThing(
      "morning-item",
      "morning thing",
      new Date("2026-05-06T09:00:00").toISOString(),
    );

    render(
      <InboxView
        things={[earlierItem]}
        lists={[]}
        onItemClick={vi.fn()}
        onToggle={vi.fn()}
        onArchive={vi.fn()}
        onAdd={vi.fn()}
        onTriage={vi.fn()}
      />,
    );

    // Sanity: pre-midnight, the item is in the "EARLIER TODAY" bucket.
    expect(screen.getByText("EARLIER TODAY")).toBeInTheDocument();
    expect(screen.queryByText("YESTERDAY")).not.toBeInTheDocument();

    // Cross local midnight. Advance the clock and fire one interval tick
    // — no parent rerender, no other state change. The hook must drive
    // the re-bucket on its own.
    act(() => {
      vi.setSystemTime(new Date("2026-05-07T00:01:00"));
      vi.advanceTimersByTime(60_000);
    });

    expect(screen.getByText("YESTERDAY")).toBeInTheDocument();
    // The "EARLIER TODAY" header must vanish — there are no items in it now.
    expect(screen.queryByText("EARLIER TODAY")).not.toBeInTheDocument();
  });
});
