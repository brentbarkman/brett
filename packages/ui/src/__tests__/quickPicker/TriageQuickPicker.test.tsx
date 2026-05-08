import React from "react";
import { describe, it, expect, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { NavList } from "@brett/types";
import { TriageQuickPicker } from "../../quickPicker/TriageQuickPicker";

const MAY_7 = new Date(Date.UTC(2026, 4, 7));
const lists: NavList[] = [
  { id: "a", name: "Board Memo", count: 14, completedCount: 0, colorClass: "bg-amber-400", sortOrder: 0 },
  { id: "b", name: "Q2 Planning", count: 8, completedCount: 0, colorClass: "bg-blue-400", sortOrder: 1 },
];

function renderTriage(startWith: "date" | "list") {
  const anchor = document.createElement("div");
  anchor.getBoundingClientRect = () =>
    ({
      top: 100, left: 100, right: 300, bottom: 140, width: 200, height: 40,
      x: 100, y: 100, toJSON: () => ({}),
    }) as DOMRect;
  document.body.appendChild(anchor);
  const onCommitDate = vi.fn();
  const onCommitList = vi.fn();
  const onClose = vi.fn();
  render(
    <TriageQuickPicker
      anchorEl={anchor}
      initialDate={null}
      initialListId={null}
      lists={lists}
      suggestedListIds={["a", "b"]}
      suggestionMode="suggested"
      startWith={startWith}
      now={MAY_7}
      onCommitDate={onCommitDate}
      onCommitList={onCommitList}
      onClose={onClose}
    />,
  );
  return { onCommitDate, onCommitList, onClose };
}

describe("TriageQuickPicker", () => {
  it("startWith='date' → press T → onCommitDate fires, then list picker is shown", () => {
    const { onCommitDate, onCommitList, onClose } = renderTriage("date");
    expect(screen.getByTestId("chip-today")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "t" });
    expect(onCommitDate).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();

    expect(screen.getByTestId("chip-list-a")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "1" });
    expect(onCommitList).toHaveBeenCalledWith("a");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("startWith='list' → press 1 → onCommitList fires, date picker shown next", () => {
    const { onCommitDate, onCommitList, onClose } = renderTriage("list");
    expect(screen.getByTestId("chip-list-a")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "1" });
    expect(onCommitList).toHaveBeenCalledWith("a");
    expect(onClose).not.toHaveBeenCalled();

    expect(screen.getByTestId("chip-today")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "m" });
    expect(onCommitDate).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Escape during step 1 closes without any commit", () => {
    const { onCommitDate, onCommitList, onClose } = renderTriage("date");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onCommitDate).not.toHaveBeenCalled();
    expect(onCommitList).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Escape during step 2 closes — step-1 commit is NOT rolled back", () => {
    const { onCommitDate, onCommitList, onClose } = renderTriage("date");
    fireEvent.keyDown(window, { key: "t" });
    expect(onCommitDate).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onCommitList).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
