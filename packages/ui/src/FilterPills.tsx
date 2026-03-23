import React from "react";
import type { FilterType } from "@brett/types";

interface FilterPillsProps {
  activeFilter: FilterType;
  onSelectFilter: (filter: FilterType) => void;
}

const FILTERS: FilterType[] = ["All", "Tasks", "Content"];

export function FilterPills({ activeFilter, onSelectFilter }: FilterPillsProps) {
  return (
    <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-hide w-full">
      {FILTERS.map((filter) => {
        const isActive = activeFilter === filter;
        return (
          <button
            key={filter}
            onClick={() => onSelectFilter(filter)}
            className={`
              px-4 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-all duration-200
              ${
                isActive
                  ? "bg-white/15 text-white border border-white/20"
                  : "bg-white/5 text-white/50 border border-white/10 hover:bg-white/10 hover:text-white/80"
              }
            `}
          >
            {filter}
          </button>
        );
      })}
    </div>
  );
}
