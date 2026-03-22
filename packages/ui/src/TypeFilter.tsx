import React from "react";
import type { FilterType } from "@brett/types";

interface TypeFilterProps {
  value: FilterType;
  onChange: (v: FilterType) => void;
}

const OPTIONS: FilterType[] = ["All", "Tasks", "Content"];

export function TypeFilter({ value, onChange }: TypeFilterProps) {
  return (
    <div className="flex items-center gap-1 bg-white/5 rounded-lg p-0.5">
      {OPTIONS.map((opt) => (
        <button
          key={opt}
          onClick={() => onChange(opt)}
          className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
            value === opt
              ? "bg-white/10 text-white/80"
              : "text-white/40 hover:text-white/60"
          }`}
        >
          {opt}
        </button>
      ))}
    </div>
  );
}
