import React, { useState, useRef, useEffect } from "react";
import type { WeatherData } from "@brett/types";

interface WeatherExpandedProps {
  weather: WeatherData;
}

export function WeatherExpanded({ weather }: WeatherExpandedProps) {
  const hourlyRef = useRef<HTMLDivElement>(null);
  const now = new Date();
  const todayStr = now.toISOString().split("T")[0];
  const [selectedDay, setSelectedDay] = useState(todayStr);

  const weekMin = Math.min(...weather.daily.map((d) => d.low));
  const weekMax = Math.max(...weather.daily.map((d) => d.high));
  const weekRange = weekMax - weekMin || 1;
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  // Filter hourly data to the selected day
  const dayHours = weather.hourly.filter((h) => h.hour.startsWith(selectedDay));
  const isToday = selectedDay === todayStr;

  // For today, start from "now"; for other days show all hours
  let visibleHours = dayHours;
  let nowHourIdx = -1;
  if (isToday) {
    nowHourIdx = dayHours.findIndex((h) => new Date(h.hour) >= now);
    const startIdx = nowHourIdx >= 0 ? nowHourIdx : Math.max(0, dayHours.length - 12);
    visibleHours = dayHours.slice(startIdx, startIdx + 12);
  }

  // Scroll to start when day changes
  useEffect(() => {
    hourlyRef.current?.scrollTo({ left: 0 });
  }, [selectedDay]);

  const formatHour = (iso: string) => {
    const d = new Date(iso);
    const h = d.getHours();
    if (h === 0) return "12am";
    if (h === 12) return "12pm";
    return h > 12 ? `${h - 12}pm` : `${h}am`;
  };

  const getDayLabel = (dateStr: string) => {
    if (dateStr === todayStr) return "Today";
    const d = new Date(dateStr + "T12:00:00");
    return dayNames[d.getDay()];
  };

  // Selected day's daily data for the header
  const selectedDayData = weather.daily.find((d) => d.date === selectedDay);

  return (
    <div className="p-4">
      {/* Current conditions */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <span className="text-[32px] leading-none">
            {isToday ? weather.current.icon : selectedDayData?.icon}
          </span>
          <div>
            <div className="text-[28px] font-semibold text-white/95 leading-none">
              {isToday ? weather.current.temp : selectedDayData?.high}°
            </div>
            <div className="text-xs text-white/50 mt-0.5">
              {isToday ? weather.current.condition : getDayLabel(selectedDay)}
            </div>
          </div>
        </div>
        <div className="text-right">
          <div className="font-mono text-[11px] uppercase tracking-wider text-white/40">
            {weather.city}
          </div>
          {selectedDayData && (
            <div className="text-[11px] text-white/30 mt-0.5">
              H: {selectedDayData.high}° &nbsp; L: {selectedDayData.low}°
            </div>
          )}
        </div>
      </div>

      {/* Hourly strip */}
      <div className="mb-4">
        <div className="font-mono text-[10px] uppercase tracking-wider text-white/40 mb-2">
          {getDayLabel(selectedDay)}
        </div>
        <div ref={hourlyRef} className="flex gap-0.5 overflow-x-auto pb-1 scrollbar-hide">
          {visibleHours.map((h, i) => {
            const isNow = isToday && i === 0 && nowHourIdx >= 0;
            return (
              <div
                key={h.hour}
                className={`flex flex-col items-center gap-1 px-2.5 py-2 rounded-lg min-w-[48px] ${
                  isNow ? "bg-blue-500/10 border border-blue-500/20" : ""
                }`}
              >
                <span className={`text-[10px] ${isNow ? "text-blue-400 font-semibold" : "text-white/40"}`}>
                  {isNow ? "Now" : formatHour(h.hour)}
                </span>
                <span className="text-[13px] leading-none">{h.icon}</span>
                <span className="text-xs text-white/80">{h.temp}°</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* 7-day forecast */}
      <div>
        <div className="font-mono text-[10px] uppercase tracking-wider text-white/40 mb-2">
          This Week
        </div>
        <div className="flex flex-col gap-px">
          {weather.daily.map((d) => {
            const isDayToday = d.date === todayStr;
            const isSelected = d.date === selectedDay;
            const leftPct = ((d.low - weekMin) / weekRange) * 100;
            const rightPct = 100 - ((d.high - weekMin) / weekRange) * 100;
            return (
              <button
                key={d.date}
                onClick={() => setSelectedDay(d.date)}
                className={`flex items-center py-1.5 px-2 rounded-md transition-colors text-left ${
                  isSelected
                    ? "bg-blue-500/10"
                    : "hover:bg-white/5"
                }`}
              >
                <span className={`text-xs w-12 ${
                  isSelected ? "text-blue-400 font-medium"
                    : isDayToday ? "text-white/70 font-medium"
                    : "text-white/50"
                }`}>
                  {getDayLabel(d.date)}
                </span>
                <span className="text-sm w-7 text-center">{d.icon}</span>
                <span className="text-[11px] text-white/35 w-8 text-right">{d.low}°</span>
                <div className="flex-1 h-1 rounded-full bg-white/5 mx-2.5 relative overflow-hidden">
                  <div
                    className="absolute h-full rounded-full"
                    style={{
                      left: `${leftPct}%`,
                      right: `${rightPct}%`,
                      background: "linear-gradient(90deg, rgba(59,130,246,0.5), rgba(251,191,36,0.5))",
                    }}
                  />
                </div>
                <span className="text-[11px] text-white/80 w-8">{d.high}°</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
