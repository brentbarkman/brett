import React from "react";
import { describe, it, expect, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { NavList } from "@brett/types";
import { QuickListPicker } from "../../quickPicker/QuickListPicker";

const lists: NavList[] = [
  { id: "a", name: "Board Memo", count: 14, completedCount: 0, colorClass: "bg-amber-400", sortOrder: 0 },
  { id: "b", name: "Q2 Planning", count: 8, completedCount: 0, colorClass: "bg-blue-400", sortOrder: 1 },
  { id: "c", name: "Family", count: 3, completedCount: 0, colorClass: "bg-emerald-400", sortOrder: 2 },
  { id: "d", name: "Reading", count: 21, completedCount: 0, colorClass: "bg-orange-400", sortOrder: 3 },
  { id: "e", name: "Investing", count: 12, completedCount: 0, colorClass: "bg-violet-400", sortOrder: 4 },
];

function renderPicker(
  overrides: Partial<React.ComponentProps<typeof QuickListPicker>> = {},
) {
  const anchor = document.createElement("div");
  anchor.getBoundingClientRect = () =>
    ({
      top: 100, left: 100, right: 300, bottom: 140, width: 200, height: 40,
      x: 100, y: 100, toJSON: () => ({}),
    }) as DOMRect;
  document.body.appendChild(anchor);
  const onCommit = vi.fn();
  const onCancel = vi.fn();
  render(
    <QuickListPicker
      anchorEl={anchor}
      initialListId={null}
      lists={lists}
      suggestedListIds={["a", "b", "c", "d"]}
      suggestionMode="suggested"
      onCommit={onCommit}
      onCancel={onCancel}
      {...overrides}
    />,
  );
  return { onCommit, onCancel };
}

describe("QuickListPicker", () => {
  it("renders four chips with numbers", () => {
    renderPicker();
    expect(screen.getByTestId("chip-list-a")).toHaveTextContent("Board Memo");
    expect(screen.getByTestId("chip-list-a")).toHaveTextContent("1");
    expect(screen.getByTestId("chip-list-d")).toHaveTextContent("4");
  });

  it("commits a list when its number is pressed", () => {
    const { onCommit } = renderPicker();
    fireEvent.keyDown(window, { key: "2" });
    expect(onCommit).toHaveBeenCalledWith("b");
  });

  it("commits a list when a chip is clicked", () => {
    const { onCommit } = renderPicker();
    fireEvent.click(screen.getByTestId("chip-list-c"));
    expect(onCommit).toHaveBeenCalledWith("c");
  });

  it("clears with the No-list chip", () => {
    const { onCommit } = renderPicker();
    fireEvent.click(screen.getByTestId("chip-list-clear"));
    expect(onCommit).toHaveBeenCalledWith(null);
  });

  it("filters list rows live as the user types in the search input", () => {
    renderPicker();
    const search = screen.getByPlaceholderText(/Search lists/i) as HTMLInputElement;
    fireEvent.change(search, { target: { value: "fam" } });
    expect(screen.getByTestId("row-list-c")).toBeInTheDocument();
    expect(screen.queryByTestId("row-list-a")).not.toBeInTheDocument();
  });

  it("cancels on Escape", () => {
    const { onCancel } = renderPicker();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("Enter commits the highlighted row in the right column", () => {
    const { onCommit } = renderPicker();
    fireEvent.keyDown(window, { key: "ArrowDown" }); // first row highlighted
    fireEvent.keyDown(window, { key: "Enter" });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(typeof onCommit.mock.calls[0][0]).toBe("string");
  });

  it("shows the 'Suggested' header when mode is suggested", () => {
    renderPicker();
    expect(screen.getByText(/Suggested/i)).toBeInTheDocument();
  });

  it("shows 'Recent' header when mode is recent", () => {
    renderPicker({ suggestionMode: "recent" });
    expect(screen.getByText(/Recent/i)).toBeInTheDocument();
  });
});
