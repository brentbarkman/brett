import React from "react";
import { describe, it, expect, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ScrollableCalendar } from "../../quickPicker/ScrollableCalendar";

const MAY_7 = new Date(Date.UTC(2026, 4, 7));
const MAY_15 = new Date(Date.UTC(2026, 4, 15));

describe("ScrollableCalendar", () => {
  it("renders the weekday header above the scroll region", () => {
    render(
      <ScrollableCalendar
        anchorDate={MAY_7}
        highlightedDate={MAY_7}
        selectedDate={null}
        onHighlight={vi.fn()}
        onCommit={vi.fn()}
        monthsBefore={1}
        monthsAfter={1}
      />,
    );
    const labels = screen
      .getAllByTestId("weekday-label")
      .map((n) => n.textContent);
    expect(labels).toEqual(["S", "M", "T", "W", "T", "F", "S"]);
  });

  it("renders months from anchorDate−monthsBefore to anchorDate+monthsAfter", () => {
    render(
      <ScrollableCalendar
        anchorDate={MAY_7}
        highlightedDate={MAY_7}
        selectedDate={null}
        onHighlight={vi.fn()}
        onCommit={vi.fn()}
        monthsBefore={1}
        monthsAfter={2}
      />,
    );
    expect(screen.getByText("April 2026")).toBeInTheDocument();
    expect(screen.getByText("May 2026")).toBeInTheDocument();
    expect(screen.getByText("June 2026")).toBeInTheDocument();
    expect(screen.getByText("July 2026")).toBeInTheDocument();
  });

  it("marks the selected date with the selected attr and today with the today attr", () => {
    render(
      <ScrollableCalendar
        anchorDate={MAY_15}
        highlightedDate={MAY_15}
        selectedDate={MAY_15}
        onHighlight={vi.fn()}
        onCommit={vi.fn()}
        monthsBefore={0}
        monthsAfter={0}
        now={MAY_7}
      />,
    );
    const selected = screen.getByTestId("day-2026-05-15");
    expect(selected.dataset.selected).toBe("true");

    const today = screen.getByTestId("day-2026-05-07");
    expect(today.dataset.today).toBe("true");
  });

  it("fires onCommit when a day cell is clicked", () => {
    const onCommit = vi.fn();
    render(
      <ScrollableCalendar
        anchorDate={MAY_7}
        highlightedDate={MAY_7}
        selectedDate={null}
        onHighlight={vi.fn()}
        onCommit={onCommit}
        monthsBefore={0}
        monthsAfter={0}
        now={MAY_7}
      />,
    );
    fireEvent.click(screen.getByTestId("day-2026-05-09"));
    expect(onCommit).toHaveBeenCalledTimes(1);
    const passed = onCommit.mock.calls[0][0] as Date;
    expect(passed.toISOString().slice(0, 10)).toBe("2026-05-09");
  });

  it("fires onHighlight when a day cell is hovered", () => {
    const onHighlight = vi.fn();
    render(
      <ScrollableCalendar
        anchorDate={MAY_7}
        highlightedDate={MAY_7}
        selectedDate={null}
        onHighlight={onHighlight}
        onCommit={vi.fn()}
        monthsBefore={0}
        monthsAfter={0}
        now={MAY_7}
      />,
    );
    fireEvent.mouseEnter(screen.getByTestId("day-2026-05-12"));
    expect(onHighlight).toHaveBeenCalled();
    const last = onHighlight.mock.calls.at(-1)![0] as Date;
    expect(last.toISOString().slice(0, 10)).toBe("2026-05-12");
  });
});
