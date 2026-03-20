import React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

export interface CalendarHeaderProps {
  view: "day" | "days" | "month";
  onViewChange: (view: "day" | "days" | "month") => void;
  currentDate: Date;
  onDateChange: (date: Date) => void;
  onToday: () => void;
  numDays: number;
  onNumDaysChange: (days: number) => void;
}

function formatDateLabel(view: "day" | "days" | "month", date: Date, numDays: number): string {
  if (view === "day") {
    return date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  }

  if (view === "month") {
    return date.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  }

  // Days view — show range starting from currentDate
  const start = new Date(date);
  const end = new Date(start);
  end.setDate(end.getDate() + numDays - 1);

  const startMonth = start.toLocaleDateString("en-US", { month: "short" });
  const endMonth = end.toLocaleDateString("en-US", { month: "short" });
  const startYear = start.getFullYear();
  const endYear = end.getFullYear();

  if (startYear !== endYear) {
    return `${startMonth} ${start.getDate()}, ${startYear} – ${endMonth} ${end.getDate()}, ${endYear}`;
  }
  if (startMonth !== endMonth) {
    return `${startMonth} ${start.getDate()} – ${endMonth} ${end.getDate()}, ${endYear}`;
  }
  return `${startMonth} ${start.getDate()}–${end.getDate()}, ${endYear}`;
}

function navigateDate(view: "day" | "days" | "month", date: Date, direction: -1 | 1, numDays: number): Date {
  const next = new Date(date);
  if (view === "day") {
    next.setDate(next.getDate() + direction);
  } else if (view === "days") {
    next.setDate(next.getDate() + direction * numDays);
  } else {
    next.setMonth(next.getMonth() + direction);
  }
  return next;
}

const views: Array<{ key: "day" | "days" | "month"; label: string }> = [
  { key: "day", label: "Day" },
  { key: "days", label: "Days" },
  { key: "month", label: "Month" },
];

export function CalendarHeader({
  view,
  onViewChange,
  currentDate,
  onDateChange,
  onToday,
  numDays,
  onNumDaysChange,
}: CalendarHeaderProps) {
  return (
    <div className="flex items-center justify-between px-4 py-3 bg-black/30 backdrop-blur-xl rounded-xl border border-white/10">
      {/* Left: Navigation */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => onDateChange(navigateDate(view, currentDate, -1, numDays))}
          className="p-1.5 text-white/50 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
        >
          <ChevronLeft size={18} />
        </button>
        <button
          onClick={() => onDateChange(navigateDate(view, currentDate, 1, numDays))}
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
          {formatDateLabel(view, currentDate, numDays)}
        </h2>
      </div>

      {/* Right: View toggle + days dropdown */}
      <div className="flex items-center gap-3">
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

        {/* Num days dropdown (only in days view) */}
        {view === "days" && (
          <select
            value={numDays}
            onChange={(e) => onNumDaysChange(Number(e.target.value))}
            className="bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white/70 outline-none cursor-pointer appearance-none hover:bg-white/10 transition-colors"
          >
            {[2, 3, 4, 5, 6, 7, 10, 14].map((n) => (
              <option key={n} value={n} className="bg-gray-900 text-white">
                {n} days
              </option>
            ))}
          </select>
        )}
      </div>
    </div>
  );
}
