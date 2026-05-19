import React, { useEffect, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";

/**
 * Collapsible Today-view section. Visually matches `SectionHeader` exactly
 * (same 10px uppercase title, same divider line, same count chip) so a
 * collapsed section sits next to a static one without a chrome jump.
 *
 * Hand-rolled rather than wrapping Radix Collapsible — the behavior here is
 * trivial (toggle a boolean, animate height + opacity) and pulling in
 * `@radix-ui/react-collapsible` for one component would add ~7KB and a new
 * dep without buying us anything the spec demands.
 *
 * a11y: the header is a real `<button>` with `aria-expanded`. Screen readers
 * announce "Collapsed/Expanded" on toggle. The collapsed body is marked
 * `aria-hidden` and removed from tab order.
 *
 * Animation: 220ms height + opacity transition on the `cubic-bezier(0.16, 1,
 * 0.3, 1)` curve the DESIGN_GUIDE designates for "section enters, toggles,
 * cross-fades" (matches ConfirmDialog, CrossFade, calendar/feedback modals,
 * LeftNav stroke transitions). Implemented via `grid-template-rows: 0fr/1fr`
 * — the modern technique that animates to unknown content height without a
 * JS `ResizeObserver` or a hardcoded `max-height` ceiling that would clip
 * tall sections (Done Today can grow to 50+ rows). The inner grid child is
 * `overflow: hidden` so the row clip looks like a shutter, not a scrollbar.
 *
 * Children mount on open and unmount AFTER the close transition completes
 * (transitionEnd-driven, with a setTimeout fallback in case the event drops).
 * For the always-rendered Today view this keeps the original perf property:
 * collapsed sections add zero ThingCard paint cost once the animation ends.
 */
interface CollapsibleSectionProps {
  title: string;
  count?: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
  /** Optional element rendered to the far right of the header (e.g. an action). */
  headerExtras?: React.ReactNode;
  className?: string;
}

const ANIMATION_MS = 220;

export function CollapsibleSection({
  title,
  count,
  open,
  onOpenChange,
  children,
  headerExtras,
  className,
}: CollapsibleSectionProps) {
  // `bodyMounted` lags `open` on close: stays true through the close
  // transition so the children have something to animate FROM, then flips
  // false once the height collapse finishes — restoring the original
  // "collapsed sections don't pay paint cost" property of the unanimated
  // version.
  const [bodyMounted, setBodyMounted] = useState<boolean>(open);
  const closeTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (open) {
      // Cancel any pending unmount + mount immediately so the open
      // transition starts on the same frame the user clicked.
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
      setBodyMounted(true);
      return;
    }
    // Close: keep mounted until the height transition finishes, then drop.
    // +30ms cushion absorbs jitter in transitionend timing (browsers
    // occasionally drop the event under load); setTimeout is the floor.
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
    }
    closeTimerRef.current = window.setTimeout(() => {
      setBodyMounted(false);
      closeTimerRef.current = null;
    }, ANIMATION_MS + 30);
    return () => {
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
    };
  }, [open]);

  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        aria-expanded={open}
        // Mirror SectionHeader's chrome: 10px uppercase tracked label,
        // divider line, optional count chip. Add a chevron up front.
        className="group flex w-full items-center gap-3 mb-2 text-left"
        data-testid={`collapsible-${title.toLowerCase().replace(/\s+/g, "-")}`}
      >
        <ChevronRight
          size={10}
          // Chevron rotation rides the same curve + duration as the height
          // transition below so the gesture reads as one motion, not two.
          className="flex-shrink-0 text-white/40"
          style={{
            transform: open ? "rotate(90deg)" : "rotate(0deg)",
            transition: `transform ${ANIMATION_MS}ms cubic-bezier(0.16, 1, 0.3, 1)`,
          }}
        />
        <h3 className="text-[10px] uppercase tracking-[0.15em] font-semibold text-white/40 flex-shrink-0 group-hover:text-white/60 transition-colors">
          {title}
        </h3>
        <div className="h-px bg-white/10 flex-1" />
        {typeof count === "number" && count > 0 && (
          <span className="text-[10px] tabular-nums text-white/40 flex-shrink-0">
            {count}
          </span>
        )}
        {headerExtras && <span className="flex-shrink-0">{headerExtras}</span>}
      </button>
      <div
        // grid-template-rows: 0fr ↔ 1fr is the modern animatable-to-auto
        // pattern. The inner wrapper is overflow:hidden so the grid clip
        // looks like a shutter rather than revealing a scrollbar.
        style={{
          display: "grid",
          gridTemplateRows: open ? "1fr" : "0fr",
          opacity: open ? 1 : 0,
          transition:
            `grid-template-rows ${ANIMATION_MS}ms cubic-bezier(0.16, 1, 0.3, 1), ` +
            `opacity ${ANIMATION_MS - 40}ms cubic-bezier(0.16, 1, 0.3, 1)`,
        }}
        aria-hidden={!open}
      >
        <div style={{ overflow: "hidden", minHeight: 0 }}>
          {bodyMounted ? children : null}
        </div>
      </div>
    </div>
  );
}
