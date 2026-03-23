import React, { useState } from "react";

interface StaleTooltipProps {
  days: number;
  children: React.ReactNode;
}

export function StaleTooltip({ days, children }: StaleTooltipProps) {
  const [visible, setVisible] = useState(false);

  const getMessage = () => {
    if (days >= 14) return `${days} days untouched. Do something or delete it.`;
    if (days >= 7) return `Sitting here for ${days} days. Still relevant?`;
    return `No updates in ${days} days.`;
  };

  return (
    <div
      className="relative inline-flex"
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
    >
      {children}
      {visible && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-1.5 rounded-lg bg-black/80 backdrop-blur-xl border border-white/10 shadow-xl z-50 whitespace-nowrap">
          <span className="text-[11px] text-white/70">{getMessage()}</span>
          <div className="absolute top-full left-1/2 -translate-x-1/2 w-2 h-2 bg-black/80 border-r border-b border-white/10 rotate-45 -mt-1" />
        </div>
      )}
    </div>
  );
}
