import React from "react";
import { describe, it, expect, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QuickDatePicker } from "../../quickPicker/QuickDatePicker";

const MAY_7 = new Date(Date.UTC(2026, 4, 7)); // Thursday

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
  it("renders the five preset chips with letters and resolved dates", () => {
    renderPicker();
    expect(screen.getByTestId("chip-today")).toHaveTextContent("Today");
    expect(screen.getByTestId("chip-today")).toHaveTextContent("Thu · May 7");
    expect(screen.getByTestId("chip-tomorrow")).toHaveTextContent("Tomorrow");
    expect(screen.getByTestId("chip-this_week")).toHaveTextContent("This Week");
    expect(screen.getByTestId("chip-next_week")).toHaveTextContent("Next Week");
    expect(screen.getByTestId("chip-next_month")).toHaveTextContent("Next Month");

    expect(screen.getByTestId("chip-today")).toHaveTextContent("T");
    expect(screen.getByTestId("chip-tomorrow")).toHaveTextContent("M");
    expect(screen.getByTestId("chip-this_week")).toHaveTextContent("W");
    expect(screen.getByTestId("chip-next_week")).toHaveTextContent("N");
    expect(screen.getByTestId("chip-next_month")).toHaveTextContent("X");
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

  it("clears the date on Backspace and Delete", () => {
    const { onCommit } = renderPicker({ initialDate: MAY_7 });
    fireEvent.keyDown(window, { key: "Backspace" });
    expect(onCommit).toHaveBeenLastCalledWith(null);

    onCommit.mockClear();
    fireEvent.keyDown(window, { key: "Delete" });
    expect(onCommit).toHaveBeenLastCalledWith(null);
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
});
