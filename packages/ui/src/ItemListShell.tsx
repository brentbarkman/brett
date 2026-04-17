import React from "react";

interface ItemListShellProps {
  header: React.ReactNode;
  children: React.ReactNode;
  /** Keyboard hint shortcuts to show below the card */
  hints?: string[];
}

/**
 * Glass card wrapper for list views (Inbox, Upcoming, custom lists).
 * Self-contained height + internal scroll — the card's rounded corners are
 * always visible, content scrolls inside rather than extending past the
 * viewport. Relies on the parent chain providing a bounded height (MainLayout
 * passes h-full + flex-col down).
 */
export function ItemListShell({ header, children, hints }: ItemListShellProps) {
  return (
    <div className="flex flex-col gap-4 pb-4 h-full min-h-0">
      <div
        tabIndex={0}
        className="flex-1 min-h-0 flex flex-col bg-black/40 backdrop-blur-xl rounded-xl border border-white/10 outline-none overflow-hidden"
      >
        {/* Header — fixed at top of card */}
        <div className="flex-shrink-0 flex items-center justify-between px-4 pt-4 pb-4">
          {header}
        </div>

        {/* Scrollable content */}
        <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide px-4 pb-4">
          {children}
        </div>
      </div>

      {/* Keyboard hint bar — fixed at bottom of viewport */}
      {hints && hints.length > 0 && (
        <div className="flex-shrink-0 flex items-center justify-center gap-3 text-[10px] text-white/30 bg-black/20 backdrop-blur-xl rounded-lg px-4 py-2 mx-auto w-fit">
          {hints.map((hint) => {
            const spaceIdx = hint.indexOf(" ");
            if (spaceIdx === -1) return <span key={hint}>{hint}</span>;
            const key = hint.slice(0, spaceIdx);
            const desc = hint.slice(spaceIdx + 1);
            return (
              <span key={hint} className="flex items-center gap-1">
                <kbd className="bg-white/10 px-1.5 py-0.5 rounded text-white/50 text-[10px]">{key}</kbd>
                <span>{desc}</span>
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
