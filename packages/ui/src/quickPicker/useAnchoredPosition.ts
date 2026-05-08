import { useState, useLayoutEffect, type RefObject } from "react";

type Placement = "bottom-end" | "bottom-start" | "top-end" | "top-start";

export interface AnchoredPosition {
  top: number;
  left: number;
  placement: Placement;
}

const VIEWPORT_GUTTER = 8;
const ANCHOR_GAP = 4;

export function useAnchoredPosition(
  anchorEl: HTMLElement | null,
  popoverRef: RefObject<HTMLElement | null>,
  options: { preferred?: Placement; version?: number } = {},
): AnchoredPosition {
  const preferred = options.preferred ?? "bottom-end";
  const version = options.version ?? 0;
  const [pos, setPos] = useState<AnchoredPosition>({
    top: -9999,
    left: -9999,
    placement: preferred,
  });

  useLayoutEffect(() => {
    if (!anchorEl || !popoverRef.current) return;

    function compute(): AnchoredPosition | null {
      // If the anchor was removed from the DOM (e.g. the row that triggered
      // the popover was filtered out by a refetch), freeze position at the
      // last known good value rather than collapsing to (0,0).
      if (!document.contains(anchorEl)) return null;

      const anchor = anchorEl!.getBoundingClientRect();
      const popover = popoverRef.current!.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;

      let placement: Placement = preferred;
      const fitsBelow =
        anchor.bottom + ANCHOR_GAP + popover.height + VIEWPORT_GUTTER <= vh;
      const fitsAbove =
        anchor.top - ANCHOR_GAP - popover.height - VIEWPORT_GUTTER >= 0;

      if (placement.startsWith("bottom") && !fitsBelow && fitsAbove) {
        placement = placement.replace("bottom", "top") as Placement;
      } else if (placement.startsWith("top") && !fitsAbove && fitsBelow) {
        placement = placement.replace("top", "bottom") as Placement;
      }

      const top = placement.startsWith("bottom")
        ? anchor.bottom + ANCHOR_GAP
        : anchor.top - ANCHOR_GAP - popover.height;

      const rawLeft = placement.endsWith("end")
        ? anchor.right - popover.width
        : anchor.left;

      const left = Math.max(
        VIEWPORT_GUTTER,
        Math.min(rawLeft, vw - popover.width - VIEWPORT_GUTTER),
      );

      return { top, left, placement };
    }

    function update() {
      const next = compute();
      if (next !== null) setPos(next);
    }
    update();

    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [anchorEl, popoverRef, preferred, version]);

  return pos;
}
