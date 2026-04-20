import React from "react";
import { describe, it, expect, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
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
