import React from "react";
import { describe, it, expect, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { Thing, NavList } from "@brett/types";
import { InboxView } from "../InboxView";

function makeThing(id: string, title: string): Thing {
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
    createdAt: new Date().toISOString(),
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
