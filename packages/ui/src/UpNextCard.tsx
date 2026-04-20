import React from "react";
import type { CalendarEventDisplay } from "@brett/types";
import { useDisplayTitle } from "./lib/demoMode";

interface UpNextCardProps {
  event: CalendarEventDisplay;
  onClick: () => void;
}

export function UpNextCard({ event, onClick }: UpNextCardProps) {
  const shownTitle = useDisplayTitle(event.id, event.title, "calendar");
  return (
    <div
      onClick={onClick}
      className="w-full bg-black/40 backdrop-blur-md border border-amber-500/30 rounded-xl p-4 cursor-pointer hover:bg-black/60 transition-colors duration-200 group relative overflow-hidden"
    >
      {/* Subtle warm glow background */}
      <div className="absolute top-0 right-0 w-32 h-32 bg-amber-500/5 rounded-full blur-2xl -mr-10 -mt-10 pointer-events-none" />

      <div className="flex items-center gap-3 mb-2">
        <span className="text-[10px] uppercase tracking-[0.15em] font-semibold text-amber-500/90">
          Up Next
        </span>
        <span className="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400 text-xs font-medium">
          in 28 min
        </span>
      </div>

      <h3 className="text-xl font-semibold text-white mb-2 group-hover:text-amber-50 transition-colors">
        {shownTitle}
      </h3>

      {event.brettObservation && (
        <div className="flex items-start gap-2 mt-3">
          <div className="w-1 h-full min-h-[20px] bg-brett-gold/30 rounded-full" />
          <p className="text-sm italic text-brett-gold/80 leading-snug">
            {event.brettObservation}
          </p>
        </div>
      )}
    </div>
  );
}
