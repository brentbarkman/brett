import React from "react";
import type { WeatherCurrent } from "@brett/types";

interface WeatherPillProps {
  current: WeatherCurrent;
  isActive: boolean;
  onClick: () => void;
}

export function WeatherPill({ current, isActive, onClick }: WeatherPillProps) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full transition-colors flex-shrink-0 cursor-pointer select-none ${
        isActive
          ? "bg-brett-gold/10 border border-brett-gold/30"
          : "bg-white/5 border border-white/10 hover:bg-white/10"
      }`}
      title="Weather"
    >
      <span className="text-[15px] leading-none pointer-events-none">{current.icon}</span>
      <span className="text-[13px] font-medium text-white/80 pointer-events-none">{current.temp}°</span>
    </button>
  );
}

export function WeatherPillSkeleton() {
  return (
    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/5 border border-white/10 flex-shrink-0 animate-pulse">
      <div className="w-4 h-4 rounded bg-white/10" />
      <div className="w-6 h-3 rounded bg-white/10" />
    </div>
  );
}

export function WeatherPillEmpty({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/5 border border-white/10 hover:bg-white/10 transition-colors flex-shrink-0 cursor-pointer select-none"
      title="Set your location for weather"
    >
      <span className="text-[15px] leading-none opacity-40 pointer-events-none">☁️</span>
      <span className="text-[13px] text-white/30 pointer-events-none">--°</span>
    </button>
  );
}
