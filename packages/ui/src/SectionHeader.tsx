import React from "react";

interface SectionHeaderProps {
  title: string;
}

export function SectionHeader({ title }: SectionHeaderProps) {
  return (
    <div className="flex items-center gap-3 mb-2">
      <h3 className="font-mono text-[11px] uppercase tracking-wider text-white/40 font-semibold flex-shrink-0">
        {title}
      </h3>
      <div className="h-px bg-white/10 flex-1" />
    </div>
  );
}
