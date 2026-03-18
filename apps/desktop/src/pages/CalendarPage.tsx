import React, { useState, useEffect, useMemo } from "react";
import type { CalendarEventRecord } from "@brett/types";
import { useCalendarEvents } from "../api/calendar";
import { CalendarHeader } from "../components/calendar/CalendarHeader";
import { CalendarDayView } from "../components/calendar/CalendarDayView";
import { CalendarWeekView } from "../components/calendar/CalendarWeekView";
import { CalendarMonthView } from "../components/calendar/CalendarMonthView";

interface CalendarPageProps {
  onEventClick: (event: CalendarEventRecord) => void;
}

function getWeekStartDate(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  d.setDate(d.getDate() - day); // Sunday start
  return d;
}

function formatDateParam(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function CalendarPage({ onEventClick }: CalendarPageProps) {
  const [view, setView] = useState<"day" | "week" | "month">("week");
  const [currentDate, setCurrentDate] = useState(new Date());
  const [daysPerWeek, setDaysPerWeek] = useState(() =>
    Number(localStorage.getItem("brett-calendar-days") ?? 7)
  );

  useEffect(() => {
    localStorage.setItem("brett-calendar-days", String(daysPerWeek));
  }, [daysPerWeek]);

  // Compute date range based on view
  const { startDate, endDate } = useMemo(() => {
    if (view === "day") {
      const start = new Date(currentDate);
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setDate(end.getDate() + 1);
      return { startDate: formatDateParam(start), endDate: formatDateParam(end) };
    }

    if (view === "week") {
      const start = getWeekStartDate(currentDate);
      const end = new Date(start);
      end.setDate(end.getDate() + daysPerWeek);
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
  }, [view, currentDate, daysPerWeek]);

  const { data } = useCalendarEvents({ startDate, endDate });
  const events: CalendarEventRecord[] = data?.events ?? [];

  const handleToday = () => setCurrentDate(new Date());

  const weekStartDate = useMemo(() => getWeekStartDate(currentDate), [currentDate]);

  const handleDayClick = (date: Date) => {
    setCurrentDate(date);
    setView("day");
  };

  return (
    <div className="flex flex-col flex-1 min-w-0 h-full gap-3 p-4">
      <CalendarHeader
        view={view}
        onViewChange={setView}
        currentDate={currentDate}
        onDateChange={setCurrentDate}
        onToday={handleToday}
        daysPerWeek={daysPerWeek}
        onDaysPerWeekChange={setDaysPerWeek}
      />

      <div className="flex-1 min-h-0 bg-black/30 backdrop-blur-xl rounded-xl border border-white/10 overflow-hidden">
        {view === "day" && (
          <CalendarDayView
            date={currentDate}
            events={events}
            onEventClick={onEventClick}
          />
        )}
        {view === "week" && (
          <CalendarWeekView
            startDate={weekStartDate}
            daysPerWeek={daysPerWeek}
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
