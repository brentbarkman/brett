import React from "react";

interface SectionHeaderProps {
  title: string;
}

export function SectionHeader({ title }: SectionHeaderProps) {
  return (
    <div className="flex items-center gap-3 mb-2">
      <h3 className="text-[10px] uppercase tracking-[0.15em] font-semibold text-white/40 flex-shrink-0">
        {title}
      </h3>
      <div className="h-px bg-white/10 flex-1" />
    </div>
  );
}
