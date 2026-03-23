import React from "react";

interface SectionHeaderProps {
  title: string;
}

export function SectionHeader({ title }: SectionHeaderProps) {
  return (
    <div className="flex items-center gap-3 mb-2">
      <h3 className="text-[11px] uppercase tracking-widest text-white/30 font-medium flex-shrink-0">
        {title}
      </h3>
      <div className="h-px bg-white/10 flex-1" />
    </div>
  );
}
