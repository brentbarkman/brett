import React from "react";
import type { Thing } from "@brett/types";
import { ThingCard } from "./ThingCard";

interface ThingsListProps {
  things: Thing[];
  onItemClick: (thing: Thing) => void;
}

export function ThingsList({ things, onItemClick }: ThingsListProps) {
  const grouped = {
    overdue: things.filter((t) => t.urgency === "overdue"),
    today: things.filter((t) => t.urgency === "today"),
    this_week: things.filter((t) => t.urgency === "this_week"),
    done: things.filter((t) => t.urgency === "done"),
  };

  const renderSection = (title: string, items: Thing[]) => {
    if (items.length === 0) return null;
    return (
      <div className="bg-black/30 backdrop-blur-xl rounded-xl border border-white/10 p-4">
        <div className="flex items-center gap-3 mb-3">
          <h3 className="font-mono text-xs uppercase tracking-wider text-white/40 font-semibold flex-shrink-0">
            {title}
          </h3>
          <div className="h-px bg-white/10 flex-1" />
        </div>
        <div className="flex flex-col gap-2">
          {items.map((item) => (
            <ThingCard
              key={item.id}
              thing={item}
              onClick={() => onItemClick(item)}
            />
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-4 pb-20">
      {renderSection("Overdue", grouped.overdue)}
      {renderSection("Today", grouped.today)}
      {renderSection("This Week", grouped.this_week)}
      {renderSection("Done", grouped.done)}
    </div>
  );
}
