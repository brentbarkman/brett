import React from "react";

interface FilterPillsProps {
  activeFilter: string;
  onSelectFilter: (filter: string) => void;
}

const FILTERS = ["All", "Tasks", "Content"];

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
                  ? "bg-blue-500 text-white border border-blue-400 shadow-[0_0_10px_rgba(59,130,246,0.3)]"
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
