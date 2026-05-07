import React, { useRef, useLayoutEffect } from "react";
import { describe, it, expect, beforeEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render } from "@testing-library/react";
import { useAnchoredPosition } from "../../quickPicker/useAnchoredPosition";

function Probe({
  anchor,
  popoverWidth,
  popoverHeight,
  preferred = "bottom-end" as const,
}: {
  anchor: HTMLElement | null;
  popoverWidth: number;
  popoverHeight: number;
  preferred?: "bottom-end" | "bottom-start" | "top-end" | "top-start";
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Stub the popover's bounding rect so the hook reads a deterministic size in jsdom.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.getBoundingClientRect = () => ({
      width: popoverWidth,
      height: popoverHeight,
      top: 0, left: 0, right: popoverWidth, bottom: popoverHeight,
      x: 0, y: 0, toJSON: () => ({}),
    }) as DOMRect;
  }, [popoverWidth, popoverHeight]);

  const pos = useAnchoredPosition(anchor, ref, { preferred });
  return (
    <div
      ref={ref}
      data-testid="popover"
      style={{ width: popoverWidth, height: popoverHeight, position: "fixed", top: pos.top, left: pos.left }}
      data-placement={pos.placement}
    />
  );
}

beforeEach(() => {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1280 });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 });
});

function makeAnchor(rect: { top: number; left: number; right: number; bottom: number }) {
  const el = document.createElement("div");
  el.getBoundingClientRect = () => ({
    top: rect.top, left: rect.left, right: rect.right, bottom: rect.bottom,
    width: rect.right - rect.left, height: rect.bottom - rect.top,
    x: rect.left, y: rect.top, toJSON: () => ({}),
  }) as DOMRect;
  document.body.appendChild(el);
  return el;
}

describe("useAnchoredPosition", () => {
  it("places popover at bottom-end of anchor when there is room below", () => {
    // Anchor at right=600 with popoverWidth=330 → left = 600-330 = 270 (no clamping)
    const anchor = makeAnchor({ top: 100, left: 400, right: 600, bottom: 140 });
    const { getByTestId } = render(<Probe anchor={anchor} popoverWidth={330} popoverHeight={300} />);
    const popover = getByTestId("popover");

    expect(popover.dataset.placement).toBe("bottom-end");
    expect(popover.style.top).toBe("144px");  // anchor.bottom (140) + 4 gap
    expect(popover.style.left).toBe("270px"); // 600 - 330
  });

  it("flips to top-end when there isn't enough room below", () => {
    // Anchor near bottom of viewport: bottom=640, vh=800. Popover height 300 needs 300+4=304px below; only 160 available → flip.
    const anchor = makeAnchor({ top: 600, left: 800, right: 1000, bottom: 640 });
    const { getByTestId } = render(<Probe anchor={anchor} popoverWidth={330} popoverHeight={300} />);
    const popover = getByTestId("popover");

    expect(popover.dataset.placement).toBe("top-end");
    expect(popover.style.top).toBe("296px"); // anchor.top (600) − 300 − 4
  });

  it("clamps left coordinate so popover stays inside the viewport", () => {
    // Anchor at left edge: bottom-end would put left at 100-330 = -230. Should clamp to gutter (8).
    const anchor = makeAnchor({ top: 100, left: 0, right: 100, bottom: 140 });
    const { getByTestId } = render(<Probe anchor={anchor} popoverWidth={330} popoverHeight={300} />);
    const popover = getByTestId("popover");
    expect(parseFloat(popover.style.left)).toBeGreaterThanOrEqual(8);
  });
});
