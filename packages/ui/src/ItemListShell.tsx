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
        <div className="flex items-center justify-center gap-4 text-[10px] text-white/20 font-mono">
          {hints.map((hint) => (
            <span key={hint}>{hint}</span>
          ))}
        </div>
      )}
    </div>
  );
}
