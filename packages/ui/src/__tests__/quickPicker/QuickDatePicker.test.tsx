import React from "react";
import { describe, it, expect, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QuickDatePicker } from "../../quickPicker/QuickDatePicker";

// Noon UTC so the test is timezone-stable: every TZ within ±12 hours of UTC
// agrees that the local calendar date is May 7. (Midnight UTC would be May 6
// evening in any timezone west of UTC, breaking the picker now that it uses
// the user's local "today" instead of UTC.)
const MAY_7 = new Date(Date.UTC(2026, 4, 7, 12)); // Thursday May 7, noon UTC

function renderPicker(
  overrides: Partial<React.ComponentProps<typeof QuickDatePicker>> = {},
) {
  const anchor = document.createElement("div");
  anchor.getBoundingClientRect = () =>
    ({
      top: 100,
      left: 100,
      right: 300,
      bottom: 140,
      width: 200,
      height: 40,
      x: 100,
      y: 100,
      toJSON: () => ({}),
    }) as DOMRect;
  document.body.appendChild(anchor);

  const onCommit = vi.fn();
  const onCancel = vi.fn();

  const utils = render(
    <QuickDatePicker
      anchorEl={anchor}
      initialDate={null}
      now={MAY_7}
      onCommit={onCommit}
      onCancel={onCancel}
      {...overrides}
    />,
  );
  return { anchor, onCommit, onCancel, ...utils };
}

describe("QuickDatePicker", () => {
  it("renders the seven preset chips with letters and resolved dates", () => {
    renderPicker();
    expect(screen.getByTestId("chip-today")).toHaveTextContent("Today");
    expect(screen.getByTestId("chip-today")).toHaveTextContent("Thu · May 7");
    expect(screen.getByTestId("chip-tonight")).toHaveTextContent("Tonight");
    // Tonight resolves to the same calendar day as Today.
    expect(screen.getByTestId("chip-tonight")).toHaveTextContent("Thu · May 7");
    expect(screen.getByTestId("chip-tomorrow")).toHaveTextContent("Tomorrow");
    expect(screen.getByTestId("chip-this_weekend")).toHaveTextContent("This Weekend");
    expect(screen.getByTestId("chip-this_weekend")).toHaveTextContent("Sat · May 9");
    expect(screen.getByTestId("chip-this_week")).toHaveTextContent("This Week");
    expect(screen.getByTestId("chip-next_week")).toHaveTextContent("Next Week");
    expect(screen.getByTestId("chip-next_month")).toHaveTextContent("Next Month");

    expect(screen.getByTestId("chip-today")).toHaveTextContent("T");
    expect(screen.getByTestId("chip-tonight")).toHaveTextContent("E");
    expect(screen.getByTestId("chip-tomorrow")).toHaveTextContent("M");
    expect(screen.getByTestId("chip-this_weekend")).toHaveTextContent("S");
    expect(screen.getByTestId("chip-this_week")).toHaveTextContent("W");
    expect(screen.getByTestId("chip-next_week")).toHaveTextContent("N");
    expect(screen.getByTestId("chip-next_month")).toHaveTextContent("X");
  });

  it("commits tonight=true when the Tonight chip is picked, tonight=false for every other preset", () => {
    const { onCommit } = renderPicker();
    fireEvent.keyDown(window, { key: "e" });
    expect(onCommit).toHaveBeenLastCalledWith(expect.any(Date), "day", true);

    onCommit.mockClear();
    fireEvent.keyDown(window, { key: "t" });
    // Today (and every non-Tonight chip) must explicitly pass tonight=false
    // so re-triaging a Tonight task into another bucket clears the flag.
    expect(onCommit).toHaveBeenLastCalledWith(expect.any(Date), "day", false);

    onCommit.mockClear();
    fireEvent.keyDown(window, { key: "m" });
    expect(onCommit).toHaveBeenLastCalledWith(expect.any(Date), "day", false);
  });

  it("commits today when 't' is pressed", () => {
    const { onCommit } = renderPicker();
    fireEvent.keyDown(window, { key: "t" });
    expect(onCommit).toHaveBeenCalledTimes(1);
    const date = onCommit.mock.calls[0][0] as Date;
    expect(date.toISOString()).toBe("2026-05-07T00:00:00.000Z");
  });

  it("commits via uppercase letter as well", () => {
    const { onCommit } = renderPicker();
    fireEvent.keyDown(window, { key: "M" });
    expect(onCommit).toHaveBeenCalledTimes(1);
    const date = onCommit.mock.calls[0][0] as Date;
    expect(date.toISOString()).toBe("2026-05-08T00:00:00.000Z");
  });

  it("commits the upcoming Saturday when 's' is pressed", () => {
    const { onCommit } = renderPicker();
    fireEvent.keyDown(window, { key: "s" });
    expect(onCommit).toHaveBeenCalledTimes(1);
    const date = onCommit.mock.calls[0][0] as Date;
    expect(date.toISOString()).toBe("2026-05-09T00:00:00.000Z");
  });

  it("clears the date on Backspace and Delete", () => {
    const { onCommit } = renderPicker({ initialDate: MAY_7 });
    fireEvent.keyDown(window, { key: "Backspace" });
    // Clearing the date also clears any tonight flag — clears are never
    // partial. The third arg is `false`, not `undefined`.
    expect(onCommit).toHaveBeenLastCalledWith(null, "day", false);

    onCommit.mockClear();
    fireEvent.keyDown(window, { key: "Delete" });
    expect(onCommit).toHaveBeenLastCalledWith(null, "day", false);
  });

  it("calls onCancel on Escape and does not commit", () => {
    const { onCommit, onCancel } = renderPicker();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("commits the highlighted day when Enter is pressed", () => {
    const { onCommit } = renderPicker();
    fireEvent.keyDown(window, { key: "ArrowRight" }); // highlight May 8
    fireEvent.keyDown(window, { key: "Enter" });
    expect(onCommit).toHaveBeenCalledTimes(1);
    const date = onCommit.mock.calls[0][0] as Date;
    expect(date.toISOString().slice(0, 10)).toBe("2026-05-08");
  });

  it("commits when a calendar day is clicked", () => {
    const { onCommit } = renderPicker();
    fireEvent.click(screen.getByTestId("day-2026-05-12"));
    expect(onCommit).toHaveBeenCalledTimes(1);
    const date = onCommit.mock.calls[0][0] as Date;
    expect(date.toISOString().slice(0, 10)).toBe("2026-05-12");
  });

  it("highlights the existing date on open when initialDate is set", () => {
    renderPicker({ initialDate: new Date(Date.UTC(2026, 4, 20)) });
    expect(screen.getByTestId("day-2026-05-20").dataset.selected).toBe("true");
  });

  // Regression: the picker used to hard-code precision="day" at the call
  // site, which silently corrupted week-precision picks (this_week / next_week)
  // into Sunday day-precision items that then bucketed as this_weekend.
  describe("precision pass-through", () => {
    it("'t' (today) commits with 'day' precision", () => {
      const { onCommit } = renderPicker();
      fireEvent.keyDown(window, { key: "t" });
      expect(onCommit.mock.calls[0][1]).toBe("day");
    });

    it("'s' (this_weekend) commits with 'day' precision", () => {
      const { onCommit } = renderPicker();
      fireEvent.keyDown(window, { key: "s" });
      expect(onCommit.mock.calls[0][1]).toBe("day");
    });

    it("'w' (this_week) commits with 'day' precision (Friday-anchored, post-migration)", () => {
      const { onCommit } = renderPicker();
      fireEvent.keyDown(window, { key: "w" });
      expect(onCommit.mock.calls[0][1]).toBe("day");
    });

    it("'n' (next_week) commits with 'day' precision (Friday-anchored)", () => {
      const { onCommit } = renderPicker();
      fireEvent.keyDown(window, { key: "n" });
      expect(onCommit.mock.calls[0][1]).toBe("day");
    });

    it("raw calendar click commits with 'day' precision", () => {
      const { onCommit } = renderPicker();
      fireEvent.click(screen.getByTestId("day-2026-05-12"));
      expect(onCommit.mock.calls[0][1]).toBe("day");
    });

    it("'this_week' and 'next_week' sublabels both display a Friday (Friday-anchored)", () => {
      // Post-migration both presets store Friday day-precision. Labels read
      // straight off the stored date — no "by Friday" transform layered on
      // top of a Sunday-stored value.
      renderPicker();
      expect(screen.getByTestId("chip-this_week")).toHaveTextContent("Fri");
      expect(screen.getByTestId("chip-next_week")).toHaveTextContent("Fri");
    });
  });
});
