import React, { useState, useRef, useEffect, useCallback } from "react";
import type { WeatherData, AirQuality } from "@brett/types";

interface WeatherExpandedProps {
  weather: WeatherData;
  now?: Date;
}

function aqiBadgeStyle(aqi: number): { bg: string; text: string; border: string } {
  if (aqi <= 50) return { bg: "bg-brett-teal/20", text: "text-brett-teal", border: "border-brett-teal/20" };
  if (aqi <= 100) return { bg: "bg-amber-500/20", text: "text-amber-400", border: "border-amber-500/20" };
  return { bg: "bg-red-500/20", text: "text-red-400", border: "border-red-500/20" };
}

function AqiBadge({ airQuality }: { airQuality: AirQuality }) {
  const style = aqiBadgeStyle(airQuality.aqi);
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${style.bg} ${style.text} border ${style.border}`}>
      AQI {airQuality.aqi}
    </span>
  );
}

export function WeatherExpanded({ weather, now: nowProp }: WeatherExpandedProps) {
  const hourlyRef = useRef<HTMLDivElement>(null);
  const dayMarkerRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const scrollingToDay = useRef(false);
  const now = nowProp ?? new Date();
  const todayStr = now.toISOString().split("T")[0];
  const [selectedDay, setSelectedDay] = useState(todayStr);

  const weekMin = Math.min(...weather.daily.map((d) => d.low));
  const weekMax = Math.max(...weather.daily.map((d) => d.high));
  const weekRange = weekMax - weekMin || 1;
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  // Build continuous hourly timeline — for today, start from current hour
  const currentHourStart = new Date(now);
  currentHourStart.setMinutes(0, 0, 0);
  const nowHourIdx = weather.hourly.findIndex(
    (h: { hour: string }) => new Date(h.hour).getTime() === currentHourStart.getTime()
  );
  const startIdx = nowHourIdx >= 0 ? nowHourIdx : 0;
  const visibleHours = weather.hourly.slice(startIdx);

  // Group hours by day for day-boundary markers
  const getDayFromHour = (iso: string) => iso.slice(0, 10);

  // Detect which day is visible during scroll
  const handleScroll = useCallback(() => {
    if (scrollingToDay.current) return;
    const container = hourlyRef.current;
    if (!container) return;

    const containerLeft = container.getBoundingClientRect().left;
    const containerCenter = containerLeft + container.clientWidth / 2;

    // Find which day marker is closest to the center of the viewport
    let closestDay = todayStr;
    let closestDist = Infinity;
    for (const [day, el] of dayMarkerRefs.current) {
      const rect = el.getBoundingClientRect();
      const dist = Math.abs(rect.left - containerCenter);
      if (dist < closestDist) {
        closestDist = dist;
        closestDay = day;
      }
    }

    setSelectedDay((prev) => prev !== closestDay ? closestDay : prev);
  }, [todayStr]);

  useEffect(() => {
    const container = hourlyRef.current;
    if (!container) return;
    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => container.removeEventListener("scroll", handleScroll);
  }, [handleScroll]);

  // Click a day → scroll the hourly strip to that day (if hourly data exists)
  const scrollToDay = useCallback((day: string) => {
    setSelectedDay(day);
    const el = dayMarkerRefs.current.get(day);
    if (el && hourlyRef.current) {
      scrollingToDay.current = true;
      const containerLeft = hourlyRef.current.getBoundingClientRect().left;
      const elLeft = el.getBoundingClientRect().left;
      const scrollLeft = hourlyRef.current.scrollLeft + (elLeft - containerLeft);
      hourlyRef.current.scrollTo({ left: scrollLeft, behavior: "smooth" });
      setTimeout(() => { scrollingToDay.current = false; }, 400);
    } else if (hourlyRef.current) {
      // Day has no hourly data — scroll to the end of the strip
      hourlyRef.current.scrollTo({ left: hourlyRef.current.scrollWidth, behavior: "smooth" });
    }
  }, []);

  // Scroll to "now" on mount
  useEffect(() => {
    hourlyRef.current?.scrollTo({ left: 0 });
  }, []);

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

  const isToday = selectedDay === todayStr;
  const selectedDayData = weather.daily.find((d) => d.date === selectedDay);

  // Track which days we've seen to insert day labels in the hourly strip
  let lastDay = "";

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
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="text-xs text-white/50">
                {isToday ? weather.current.condition : getDayLabel(selectedDay)}
              </span>
              {isToday && weather.current.airQuality && (
                <AqiBadge airQuality={weather.current.airQuality} />
              )}
            </div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-[0.15em] font-semibold text-white/40">
            {weather.city}
          </div>
          {selectedDayData && (
            <div className="text-[11px] text-white/30 mt-0.5">
              H: {selectedDayData.high}° &nbsp; L: {selectedDayData.low}°
            </div>
          )}
        </div>
      </div>

      {/* Hourly strip — continuous timeline */}
      <div className="mb-4">
        <div className="text-[10px] uppercase tracking-[0.15em] font-semibold text-white/40 mb-2">
          {getDayLabel(selectedDay)}
        </div>
        <div ref={hourlyRef} className="flex gap-0.5 overflow-x-auto pb-1 scrollbar-hide">
          {visibleHours.map((h, i) => {
            const hourDay = getDayFromHour(h.hour);
            const isNow = i === 0 && nowHourIdx >= 0 && hourDay === todayStr;
            const isDayBoundary = hourDay !== lastDay;
            if (isDayBoundary) lastDay = hourDay;

            return (
              <React.Fragment key={h.hour}>
                {/* Day boundary separator */}
                {isDayBoundary && i > 0 && (
                  <div className="flex flex-col items-center justify-center px-1 min-w-[2px]">
                    <div className="w-px h-full bg-white/10" />
                  </div>
                )}
                <div
                  ref={isDayBoundary ? (el) => { if (el) dayMarkerRefs.current.set(hourDay, el); } : undefined}
                  className={`flex flex-col items-center gap-1 px-2.5 py-2 rounded-lg min-w-[48px] ${
                    isNow ? "bg-brett-gold/10 border border-brett-gold/20" : ""
                  }`}
                >
                  <span className={`text-[10px] ${
                    isNow ? "text-brett-gold font-semibold"
                      : isDayBoundary && i > 0 ? "text-white/60 font-medium"
                      : "text-white/40"
                  }`}>
                    {isNow ? "Now" : isDayBoundary && i > 0 ? getDayLabel(hourDay) : formatHour(h.hour)}
                  </span>
                  <span className="text-[13px] leading-none">{h.icon}</span>
                  <span className="text-xs text-white/80">{h.temp}°</span>
                </div>
              </React.Fragment>
            );
          })}
        </div>
      </div>

      {/* 7-day forecast */}
      <div>
        <div className="text-[10px] uppercase tracking-[0.15em] font-semibold text-white/40 mb-2">
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
                onClick={() => scrollToDay(d.date)}
                className={`flex items-center py-1.5 px-2 rounded-md transition-colors text-left ${
                  isSelected
                    ? "bg-brett-gold/10"
                    : "hover:bg-white/5"
                }`}
              >
                <span className={`text-xs w-12 ${
                  isSelected ? "text-brett-gold font-medium"
                    : isDayToday ? "text-white/70 font-medium"
                    : "text-white/50"
                }`}>
                  {getDayLabel(d.date)}
                </span>
                <span className="text-sm w-7 text-center">{d.icon}</span>
                <span className="text-[11px] text-white/40 w-8 text-right">{d.low}°</span>
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
