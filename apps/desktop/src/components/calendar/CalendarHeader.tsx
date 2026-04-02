import React, { useState, useRef, useEffect } from "react";
import { ChevronLeft, ChevronRight, ListFilter } from "lucide-react";

export type CalendarView = "day" | "5day" | "week" | "month";

export interface CalendarInfo {
  id: string;
  name: string;
  color: string;
  isVisible: boolean;
  accountId: string;
}

export interface CalendarHeaderProps {
  view: CalendarView;
  onViewChange: (view: CalendarView) => void;
  currentDate: Date;
  onDateChange: (date: Date) => void;
  onToday: () => void;
  calendars?: CalendarInfo[];
  onToggleCalendar?: (accountId: string, calendarId: string, isVisible: boolean) => void;
}

/** Get Sunday (start of week) containing the given date */
function getSunday(date: Date): Date {
  const d = new Date(date);
  d.setDate(d.getDate() - d.getDay());
  return d;
}

function formatDateLabel(view: CalendarView, date: Date): string {
  if (view === "day") {
    return date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  }
  if (view === "month") {
    return date.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  }

  // 5day starts from currentDate, week starts from Monday
  const start = view === "5day" ? new Date(date) : getSunday(date);
  const numDays = view === "5day" ? 5 : 7;
  const end = new Date(start);
  end.setDate(end.getDate() + numDays - 1);

  const startMonth = start.toLocaleDateString("en-US", { month: "short" });
  const endMonth = end.toLocaleDateString("en-US", { month: "short" });
  const year = start.getFullYear();

  if (startMonth !== endMonth) {
    return `${startMonth} ${start.getDate()} – ${endMonth} ${end.getDate()}, ${year}`;
  }
  return `${startMonth} ${start.getDate()}–${end.getDate()}, ${year}`;
}

function navigateDate(view: CalendarView, date: Date, direction: -1 | 1): Date {
  const next = new Date(date);
  if (view === "day") {
    next.setDate(next.getDate() + direction);
  } else if (view === "5day") {
    next.setDate(next.getDate() + direction * 5);
  } else if (view === "week") {
    next.setDate(next.getDate() + direction * 7);
  } else {
    next.setMonth(next.getMonth() + direction);
  }
  return next;
}

const views: Array<{ key: CalendarView; label: string }> = [
  { key: "day", label: "Day" },
  { key: "5day", label: "5 Day" },
  { key: "week", label: "Week" },
  { key: "month", label: "Month" },
];

export function CalendarHeader({
  view,
  onViewChange,
  currentDate,
  onDateChange,
  onToday,
  calendars,
  onToggleCalendar,
}: CalendarHeaderProps) {
  const [showCalendars, setShowCalendars] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click or Escape
  useEffect(() => {
    if (!showCalendars) return;
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowCalendars(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowCalendars(false);
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [showCalendars]);

  const visibleCount = calendars?.filter((c) => c.isVisible).length ?? 0;
  const totalCount = calendars?.length ?? 0;

  return (
    <div className="flex items-center justify-between px-4 py-3 bg-black/30 backdrop-blur-xl rounded-xl border border-white/10 relative z-10">
      {/* Left: Navigation */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => onDateChange(navigateDate(view, currentDate, -1))}
          className="p-1.5 text-white/50 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
        >
          <ChevronLeft size={18} />
        </button>
        <button
          onClick={() => onDateChange(navigateDate(view, currentDate, 1))}
          className="p-1.5 text-white/50 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
        >
          <ChevronRight size={18} />
        </button>
        <button
          onClick={onToday}
          className="px-3 py-1 text-xs font-medium text-white/70 hover:text-white bg-white/5 hover:bg-white/10 rounded-lg border border-white/10 transition-colors"
        >
          Today
        </button>
        <h2 className="text-white font-semibold text-lg ml-2">
          {formatDateLabel(view, currentDate)}
        </h2>
      </div>

      {/* Right: Calendars dropdown + View toggle */}
      <div className="flex items-center gap-3">
        {/* Calendars filter dropdown */}
        {calendars && calendars.length > 0 && onToggleCalendar && (
          <div className="relative" ref={dropdownRef}>
            <button
              onClick={() => setShowCalendars(!showCalendars)}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                showCalendars
                  ? "bg-white/15 text-white border-white/20"
                  : "text-white/50 hover:text-white border-white/10 hover:border-white/20 hover:bg-white/5"
              }`}
            >
              <ListFilter size={14} />
              <span>{visibleCount}/{totalCount}</span>
            </button>

            {showCalendars && (
              <div className="absolute right-0 top-full mt-2 w-64 bg-gray-900/95 backdrop-blur-xl rounded-lg border border-white/10 shadow-2xl z-50 py-1.5 overflow-hidden">
                <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-white/30 font-semibold">
                  Calendars
                </div>
                {calendars.map((cal) => (
                  <button
                    key={cal.id}
                    onClick={() => onToggleCalendar(cal.accountId, cal.id, !cal.isVisible)}
                    className="flex items-center gap-2.5 w-full px-3 py-1.5 hover:bg-white/5 transition-colors text-left"
                  >
                    <span
                      className="w-2.5 h-2.5 rounded-full flex-shrink-0 transition-opacity"
                      style={{
                        backgroundColor: cal.color,
                        opacity: cal.isVisible ? 1 : 0.25,
                      }}
                    />
                    <span className={`text-xs truncate flex-1 transition-colors ${cal.isVisible ? "text-white/80" : "text-white/30"}`}>
                      {cal.name}
                    </span>
                    {cal.isVisible && (
                      <span className="text-brett-gold text-xs">✓</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* View toggle */}
        <div className="flex bg-white/5 rounded-lg border border-white/10 overflow-hidden">
          {views.map((v) => (
            <button
              key={v.key}
              onClick={() => onViewChange(v.key)}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                view === v.key
                  ? "bg-white/15 text-white"
                  : "text-white/50 hover:text-white/80 hover:bg-white/5"
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Exported for use by CalendarPage */
export { getSunday };
