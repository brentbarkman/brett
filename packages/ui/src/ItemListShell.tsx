import React from "react";

interface ItemListShellProps {
  header: React.ReactNode;
  children: React.ReactNode;
  /** Keyboard hint shortcuts to show below the card */
  hints?: string[];
}

export function ItemListShell({ header, children, hints }: ItemListShellProps) {
  return (
    <div className="flex flex-col gap-4 pb-20">
      <div
        tabIndex={0}
        className="bg-black/30 backdrop-blur-xl rounded-xl border border-white/10 p-4 outline-none"
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          {header}
        </div>

        {children}
      </div>

      {/* Keyboard hint bar */}
      {hints && hints.length > 0 && (
        <div className="flex items-center justify-center gap-3 text-[10px] text-white/30 bg-black/20 backdrop-blur-xl rounded-lg px-4 py-2 mx-auto w-fit">
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
