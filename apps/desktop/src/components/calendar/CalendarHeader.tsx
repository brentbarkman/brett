import React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

export type CalendarView = "day" | "5day" | "week" | "month";

export interface CalendarHeaderProps {
  view: CalendarView;
  onViewChange: (view: CalendarView) => void;
  currentDate: Date;
  onDateChange: (date: Date) => void;
  onToday: () => void;
}

/** Get Monday of the week containing the given date */
function getMonday(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  d.setDate(d.getDate() - ((day + 6) % 7)); // Monday = 0 offset
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
  const start = view === "5day" ? new Date(date) : getMonday(date);
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
}: CalendarHeaderProps) {
  return (
    <div className="flex items-center justify-between px-4 py-3 bg-black/30 backdrop-blur-xl rounded-xl border border-white/10">
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

      {/* Right: View toggle */}
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
  );
}

/** Exported for use by CalendarPage */
export { getMonday };
