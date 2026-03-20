import React, { useState, useEffect, useMemo } from "react";
import type { CalendarEventRecord } from "@brett/types";
import { useCalendarEvents } from "../api/calendar";
import { useCalendarAccounts, useConnectCalendar } from "../api/calendar-accounts";
import { CalendarHeader } from "../components/calendar/CalendarHeader";
import { CalendarDayView } from "../components/calendar/CalendarDayView";
import { CalendarWeekView } from "../components/calendar/CalendarWeekView";
import { CalendarMonthView } from "../components/calendar/CalendarMonthView";

interface CalendarPageProps {
  onEventClick: (event: CalendarEventRecord) => void;
}

function formatDateParam(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function CalendarPage({ onEventClick }: CalendarPageProps) {
  const { data: accounts = [], isLoading: isLoadingAccounts } = useCalendarAccounts();
  const connectCalendar = useConnectCalendar();

  const [view, setView] = useState<"day" | "days" | "month">("days");
  const [currentDate, setCurrentDate] = useState(new Date());
  const [numDays, setNumDays] = useState(() => {
    const stored = Number(localStorage.getItem("brett-calendar-days"));
    return [2, 3, 4, 5, 6, 7, 10, 14].includes(stored) ? stored : 5;
  });

  useEffect(() => {
    localStorage.setItem("brett-calendar-days", String(numDays));
  }, [numDays]);

  // Compute date range based on view
  const { startDate, endDate } = useMemo(() => {
    if (view === "day") {
      const start = new Date(currentDate);
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setDate(end.getDate() + 1);
      return { startDate: formatDateParam(start), endDate: formatDateParam(end) };
    }

    if (view === "days") {
      const start = new Date(currentDate);
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setDate(end.getDate() + numDays);
      return { startDate: formatDateParam(start), endDate: formatDateParam(end) };
    }

    // Month view — include padding days
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startOffset = firstDay.getDay();
    const start = new Date(year, month, 1 - startOffset);
    const totalCells = Math.ceil((startOffset + lastDay.getDate()) / 7) * 7;
    const end = new Date(start);
    end.setDate(end.getDate() + totalCells);
    return { startDate: formatDateParam(start), endDate: formatDateParam(end) };
  }, [view, currentDate, numDays]);

  const { data } = useCalendarEvents({ startDate, endDate });
  const events: CalendarEventRecord[] = data?.events ?? [];

  const handleToday = () => setCurrentDate(new Date());

  const handleDayClick = (date: Date) => {
    setCurrentDate(date);
    setView("day");
  };

  // Empty state — real-looking week grid with ghost events + live CTA at current time
  if (!isLoadingAccounts && accounts.length === 0) {
    const now = new Date();
    const todayDow = now.getDay(); // 0=Sun
    const ghostDays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const ghostHours = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17];
    const gh = 60;
    const nowH = now.getHours();
    const nowM = now.getMinutes();
    const ctaHour = Math.max(8, Math.min(nowH, 16));
    const ctaTop = (ctaHour - 8) * gh + (nowM > 30 ? 30 : 0);

    const ghostEvents = [
      { col: 1, top: 0, h: 0.5, label: "Standup", bg: "rgba(59,130,246,0.12)", border: "rgba(59,130,246,0.25)", text: "rgb(147,197,253)" },
      { col: 1, top: 1.5, h: 1.5, label: "Design review", bg: "rgba(34,197,94,0.10)", border: "rgba(34,197,94,0.22)", text: "rgb(134,239,172)" },
      { col: 1, top: 5, h: 2, label: "Focus time", bg: "rgba(168,85,247,0.10)", border: "rgba(168,85,247,0.22)", text: "rgb(216,180,254)" },
      { col: 2, top: 0.5, h: 1, label: "Sprint planning", bg: "rgba(99,102,241,0.10)", border: "rgba(99,102,241,0.22)", text: "rgb(165,180,252)" },
      { col: 2, top: 4, h: 1, label: "Lunch w/ team", bg: "rgba(249,115,22,0.10)", border: "rgba(249,115,22,0.22)", text: "rgb(253,186,116)" },
      { col: 2, top: 6, h: 1.5, label: "Deep work", bg: "rgba(168,85,247,0.10)", border: "rgba(168,85,247,0.22)", text: "rgb(216,180,254)" },
      { col: 3, top: 0, h: 0.5, label: "Standup", bg: "rgba(59,130,246,0.12)", border: "rgba(59,130,246,0.25)", text: "rgb(147,197,253)" },
      { col: 3, top: 2, h: 1, label: "Eng sync", bg: "rgba(34,197,94,0.10)", border: "rgba(34,197,94,0.22)", text: "rgb(134,239,172)" },
      { col: 3, top: 4, h: 0.75, label: "Coffee chat", bg: "rgba(245,158,11,0.10)", border: "rgba(245,158,11,0.22)", text: "rgb(252,211,77)" },
      { col: 4, top: 0, h: 0.5, label: "Standup", bg: "rgba(59,130,246,0.12)", border: "rgba(59,130,246,0.25)", text: "rgb(147,197,253)" },
      { col: 4, top: 1, h: 1.5, label: "Product review", bg: "rgba(6,182,212,0.10)", border: "rgba(6,182,212,0.22)", text: "rgb(103,232,249)" },
      { col: 4, top: 5.5, h: 0.75, label: "1:1 w/ manager", bg: "rgba(236,72,153,0.10)", border: "rgba(236,72,153,0.22)", text: "rgb(249,168,212)" },
      { col: 5, top: 0, h: 0.5, label: "Standup", bg: "rgba(59,130,246,0.12)", border: "rgba(59,130,246,0.25)", text: "rgb(147,197,253)" },
      { col: 5, top: 2, h: 2, label: "Focus time", bg: "rgba(168,85,247,0.10)", border: "rgba(168,85,247,0.22)", text: "rgb(216,180,254)" },
      { col: 5, top: 7, h: 0.75, label: "Retro", bg: "rgba(99,102,241,0.10)", border: "rgba(99,102,241,0.22)", text: "rgb(165,180,252)" },
    ].filter((evt) => {
      // Remove ghosts that overlap the CTA in today's column
      if (evt.col !== todayDow) return true;
      const evtTopPx = evt.top * gh;
      const evtBottomPx = evtTopPx + evt.h * gh;
      const ctaBottom = ctaTop + 1.5 * gh;
      return evtBottomPx <= ctaTop || evtTopPx >= ctaBottom;
    });

    return (
      <div className="flex flex-col flex-1 min-w-0 h-full p-4">
        <div className="flex-1 bg-black/30 backdrop-blur-xl rounded-xl border border-white/10 overflow-hidden relative">
          {/* Week header — real */}
          <div className="flex border-b border-white/10">
            <div className="w-14 flex-shrink-0" />
            {ghostDays.map((day, i) => (
              <div key={day} className={`flex-1 py-2.5 text-center text-xs font-medium ${i === todayDow ? "text-white/80" : "text-white/30"} ${i < 6 ? "border-r border-white/5" : ""}`}>
                {day}
              </div>
            ))}
          </div>

          {/* Week grid */}
          <div className="flex flex-1 overflow-hidden" style={{ height: `${ghostHours.length * gh}px` }}>
            {/* Time gutter */}
            <div className="w-14 flex-shrink-0 relative">
              {ghostHours.map((hour) => (
                <div key={hour} className="absolute w-full text-right pr-2" style={{ top: `${(hour - 8) * gh - 7}px` }}>
                  <span className="text-[10px] text-white/30 font-medium">
                    {hour === 12 ? "12 PM" : hour > 12 ? `${hour - 12} PM` : `${hour} AM`}
                  </span>
                </div>
              ))}
            </div>

            {/* Day columns */}
            {ghostDays.map((_, dayIdx) => {
              const isToday = dayIdx === todayDow;
              return (
                <div key={dayIdx} className={`flex-1 relative ${dayIdx < 6 ? "border-r border-white/5" : ""}`}>
                  {ghostHours.map((hour) => (
                    <div key={hour} className="absolute w-full border-t border-white/5" style={{ top: `${(hour - 8) * gh}px` }} />
                  ))}

                  {/* Current time line on today */}
                  {isToday && nowH >= 8 && nowH < 18 && (
                    <div className="absolute left-0 right-0 flex items-center z-20 pointer-events-none" style={{ top: `${(nowH - 8) * gh + (nowM / 60) * gh}px` }}>
                      <div className="w-2 h-2 rounded-full bg-red-500 -ml-1" />
                      <div className="flex-1 border-t border-red-500/50" />
                    </div>
                  )}

                  {/* Ghost events */}
                  <div className="absolute inset-0 px-0.5">
                    {ghostEvents.filter((e) => e.col === dayIdx).map((evt, i) => (
                      <div
                        key={i}
                        className="absolute left-0 right-0 rounded-md border-l-2 px-1.5 py-1 opacity-50 select-none"
                        style={{ top: `${evt.top * gh}px`, height: `${evt.h * gh}px`, backgroundColor: evt.bg, borderLeftColor: evt.border }}
                      >
                        <span className="text-[10px] font-semibold" style={{ color: evt.text }}>{evt.label}</span>
                      </div>
                    ))}

                    {/* Live CTA on today's column */}
                    {isToday && (
                      <button
                        onClick={() => connectCalendar.mutate()}
                        className="absolute left-0 right-0 rounded-md border-l-2 px-2 py-2 text-left cursor-pointer transition-all hover:brightness-125 group"
                        style={{
                          top: `${ctaTop}px`,
                          height: `${1.5 * gh}px`,
                          backgroundColor: "rgba(59, 130, 246, 0.15)",
                          borderLeftColor: "rgba(59, 130, 246, 0.4)",
                        }}
                      >
                        <span className="text-[10px] font-semibold text-blue-300 block">Connect your calendar</span>
                        <span className="text-[9px] text-blue-300/50 block mt-0.5">Summaries, alerts & RSVP</span>
                        <span className="text-[8px] text-blue-400/60 font-medium mt-1 block group-hover:text-blue-300 transition-colors">
                          Click to connect →
                        </span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 min-w-0 h-full gap-3 p-4">
      <CalendarHeader
        view={view}
        onViewChange={setView}
        currentDate={currentDate}
        onDateChange={setCurrentDate}
        onToday={handleToday}
        numDays={numDays}
        onNumDaysChange={setNumDays}
      />

      <div className="flex-1 min-h-0 bg-black/30 backdrop-blur-xl rounded-xl border border-white/10 overflow-hidden">
        {view === "day" && (
          <CalendarDayView
            date={currentDate}
            events={events}
            onEventClick={onEventClick}
          />
        )}
        {view === "days" && (
          <CalendarWeekView
            startDate={currentDate}
            daysPerWeek={numDays}
            events={events}
            onEventClick={onEventClick}
          />
        )}
        {view === "month" && (
          <CalendarMonthView
            month={currentDate}
            events={events}
            onEventClick={onEventClick}
            onDayClick={handleDayClick}
          />
        )}
      </div>
    </div>
  );
}
