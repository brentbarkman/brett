import React from "react";
import { describe, it, expect, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  ScrollableCalendar,
  localDayUtcMidnight,
} from "../../quickPicker/ScrollableCalendar";

const MAY_7 = new Date(Date.UTC(2026, 4, 7));
const MAY_15 = new Date(Date.UTC(2026, 4, 15));

/**
 * Construct a Date whose local components and UTC components disagree —
 * the runtime shape of a real `new Date()` when the user is at, say,
 * 11:30 PM MT on May 31 (local) which is 5:30 AM UTC on June 1 (UTC).
 * Lets us assert the fix is TZ-independent — the unit test must catch
 * the bug even when the test runner is in UTC (CI default).
 */
function dateWithLocalAndUtc(
  local: { y: number; m: number; d: number },
  utc: { y: number; m: number; d: number; h: number; min: number },
): Date {
  const real = new Date(Date.UTC(utc.y, utc.m, utc.d, utc.h, utc.min));
  return Object.assign(real, {
    getFullYear: () => local.y,
    getMonth: () => local.m,
    getDate: () => local.d,
  });
}

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

  it("marks today using the user's LOCAL calendar day, not UTC's", () => {
    // 11:30 PM MT on May 31, 2026 — UTC has already rolled to June 1.
    const localMay31 = dateWithLocalAndUtc(
      { y: 2026, m: 4, d: 31 },
      { y: 2026, m: 5, d: 1, h: 5, min: 30 },
    );
    render(
      <ScrollableCalendar
        anchorDate={MAY_15}
        highlightedDate={MAY_15}
        selectedDate={null}
        onHighlight={vi.fn()}
        onCommit={vi.fn()}
        monthsBefore={0}
        monthsAfter={1}
        now={localMay31}
      />,
    );
    expect(screen.getByTestId("day-2026-05-31").dataset.today).toBe("true");
    expect(screen.getByTestId("day-2026-06-01").dataset.today).toBe("false");
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

describe("localDayUtcMidnight", () => {
  it("returns UTC midnight of the user's LOCAL calendar day", () => {
    // 11:30 PM MT on May 31 (local) = 5:30 AM UTC on June 1 (UTC).
    const evening = dateWithLocalAndUtc(
      { y: 2026, m: 4, d: 31 },
      { y: 2026, m: 5, d: 1, h: 5, min: 30 },
    );
    expect(localDayUtcMidnight(evening).toISOString()).toBe(
      "2026-05-31T00:00:00.000Z",
    );
  });

  it("returns UTC midnight when local and UTC days agree", () => {
    const utcMay7 = new Date(Date.UTC(2026, 4, 7, 12));
    // For a UTC-constructed Date in the (typically UTC) test runner, local
    // components match UTC components, so the result is May 7 UTC midnight.
    // This guards against an accidental "always shift by N hours" regression.
    const result = localDayUtcMidnight(utcMay7);
    expect(result.getUTCHours()).toBe(0);
    expect(result.getUTCMinutes()).toBe(0);
    expect(result.getUTCSeconds()).toBe(0);
  });
});
