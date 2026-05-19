import React from "react";
import { ChevronRight } from "lucide-react";

/**
 * Collapsible Today-view section. Visually matches `SectionHeader` exactly
 * (same 10px uppercase title, same divider line, same count chip) so a
 * collapsed section sits next to a static one without a chrome jump.
 *
 * Hand-rolled rather than wrapping Radix Collapsible — the behavior here is
 * trivial (toggle a boolean, conditionally render children) and pulling in
 * `@radix-ui/react-collapsible` for one component would add ~7KB and a new
 * dep without buying us animation or a11y the spec demands.
 *
 * a11y: the header is a real `<button>` with `aria-expanded`. Screen readers
 * announce "Collapsed/Expanded" on toggle. Children mount/unmount with `open`
 * — collapsed sections also drop from the DOM, which matters for the
 * always-rendered Today view where every extra card is a paint cost.
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

export function CollapsibleSection({
  title,
  count,
  open,
  onOpenChange,
  children,
  headerExtras,
  className,
}: CollapsibleSectionProps) {
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
          className={
            "flex-shrink-0 text-white/40 transition-transform duration-150 " +
            (open ? "rotate-90" : "rotate-0")
          }
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
      {open && <div>{children}</div>}
    </div>
  );
}
