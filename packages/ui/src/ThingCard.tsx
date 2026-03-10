import React from "react";
import { Zap, Search, Globe, Twitter, Calendar } from "lucide-react";
import type { Thing } from "@brett/types";

interface ThingCardProps {
  thing: Thing;
  onClick: () => void;
}

export function ThingCard({ thing, onClick }: ThingCardProps) {
  const getIcon = () => {
    switch (thing.type) {
      case "task":
        return <Zap size={16} className="text-blue-500" />;
      case "scout":
        return <Search size={16} className="text-purple-500" />;
      case "saved_web":
        return <Globe size={16} className="text-white/50" />;
      case "saved_tweet":
        return <Twitter size={16} className="text-sky-400" />;
    }
  };

  const getUrgencyColor = () => {
    switch (thing.urgency) {
      case "overdue":
        return "bg-red-500/20 text-red-400 border border-red-500/20";
      case "today":
        return "bg-amber-500/20 text-amber-400 border border-amber-500/20";
      default:
        return "bg-white/5 text-white/50 border border-white/5";
    }
  };

  return (
    <div
      onClick={onClick}
      className={`
        group relative flex items-center gap-3 p-3 rounded-lg cursor-pointer
        bg-white/5 hover:bg-white/10 border border-white/5 hover:border-white/10
        transition-colors duration-150
        ${thing.isCompleted ? "opacity-50" : "opacity-100"}
      `}
    >
      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-black/20 flex items-center justify-center">
        {getIcon()}
      </div>

      <div className="flex-1 min-w-0">
        <h4
          className={`text-sm font-medium text-white truncate ${thing.isCompleted ? "line-through text-white/50" : ""}`}
        >
          {thing.title}
        </h4>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-xs text-white/40 truncate">
            {thing.list} · {thing.source}
          </span>
          {thing.stalenessDays && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-white/40 border border-white/5">
              No update in {thing.stalenessDays} days
            </span>
          )}
        </div>
      </div>

      <div className="flex-shrink-0 flex items-center gap-2">
        {thing.dueDateLabel ? (
          <div
            className={`px-2.5 py-1 rounded-full text-xs font-medium ${getUrgencyColor()}`}
          >
            {thing.dueDateLabel}
          </div>
        ) : (
          <div className="w-8 h-8 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
            <Calendar size={14} className="text-white/30" />
          </div>
        )}
      </div>
    </div>
  );
}
