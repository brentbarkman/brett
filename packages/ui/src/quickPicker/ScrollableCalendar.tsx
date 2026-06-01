import React, { useEffect, useMemo, useRef } from "react";

export interface ScrollableCalendarProps {
  anchorDate: Date;
  highlightedDate: Date;
  selectedDate: Date | null;
  onHighlight: (date: Date) => void;
  onCommit: (date: Date) => void;
  monthsBefore?: number;
  monthsAfter?: number;
  now?: Date;
}

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

function startOfMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function sameDay(a: Date, b: Date): boolean {
  return isoDay(a) === isoDay(b);
}

function buildMonths(anchor: Date, before: number, after: number): Date[] {
  const months: Date[] = [];
  const base = startOfMonth(anchor);
  for (let i = -before; i <= after; i++) {
    months.push(new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + i, 1)));
  }
  return months;
}

function daysInMonth(m: Date): Date[] {
  const days: Date[] = [];
  const year = m.getUTCFullYear();
  const month = m.getUTCMonth();
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  for (let day = 1; day <= last; day++) {
    days.push(new Date(Date.UTC(year, month, day)));
  }
  return days;
}

const MONTH_LABEL_FORMATTER = new Intl.DateTimeFormat("en-US", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

/**
 * UTC midnight of the user's LOCAL calendar day. Day cells in the grid are
 * UTC-midnight Dates, and `isoDay` compares via `toISOString()` (UTC). Using
 * `new Date()` (or any local-time Date) directly leaks the UTC-offset hours
 * into the comparison — for any user whose local day differs from UTC's day
 * the today pill lands on the wrong cell.
 */
export function localDayUtcMidnight(d: Date): Date {
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
}

export function ScrollableCalendar({
  anchorDate,
  highlightedDate,
  selectedDate,
  onHighlight,
  onCommit,
  monthsBefore = 12,
  monthsAfter = 24,
  now,
}: ScrollableCalendarProps) {
  const today = useMemo(() => localDayUtcMidnight(now ?? new Date()), [now]);
  const months = useMemo(
    () => buildMonths(anchorDate, monthsBefore, monthsAfter),
    [anchorDate, monthsBefore, monthsAfter],
  );

  const scrollRef = useRef<HTMLDivElement>(null);
  const anchorRowRef = useRef<HTMLDivElement>(null);

  // Scroll anchor month into view on mount and whenever anchorDate changes.
  useEffect(() => {
    if (anchorRowRef.current && scrollRef.current) {
      const top = Math.max(0, anchorRowRef.current.offsetTop - 32);
      if (typeof scrollRef.current.scrollTo === "function") {
        scrollRef.current.scrollTo({ top, behavior: "auto" });
      } else {
        scrollRef.current.scrollTop = top;
      }
    }
  }, [anchorDate]);

  return (
    <div className="flex flex-col">
      <div className="grid grid-cols-7 gap-0.5 px-1 pb-1 border-b border-white/5">
        {WEEKDAYS.map((w, i) => (
          <div
            key={i}
            data-testid="weekday-label"
            className="text-center text-[8px] text-white/45"
          >
            {w}
          </div>
        ))}
      </div>
      <div
        ref={scrollRef}
        className="relative max-h-[240px] overflow-y-auto px-1 pt-1"
        style={{ scrollbarWidth: "thin" }}
      >
        {months.map((m) => (
          <MonthGrid
            key={isoDay(m)}
            month={m}
            highlightedDate={highlightedDate}
            selectedDate={selectedDate}
            today={today}
            anchorDate={anchorDate}
            anchorRowRef={anchorRowRef}
            onHighlight={onHighlight}
            onCommit={onCommit}
          />
        ))}
        <div className="pointer-events-none sticky bottom-0 left-0 right-0 h-6 bg-gradient-to-t from-[rgba(20,20,22,0.95)] to-transparent" />
      </div>
    </div>
  );
}

function MonthGrid({
  month,
  highlightedDate,
  selectedDate,
  today,
  anchorDate,
  anchorRowRef,
  onHighlight,
  onCommit,
}: {
  month: Date;
  highlightedDate: Date;
  selectedDate: Date | null;
  today: Date;
  anchorDate: Date;
  anchorRowRef: React.RefObject<HTMLDivElement | null>;
  onHighlight: (d: Date) => void;
  onCommit: (d: Date) => void;
}) {
  const days = useMemo(() => daysInMonth(month), [month]);
  const firstWeekday = month.getUTCDay();
  const blanks = Array.from({ length: firstWeekday });
  const isAnchorMonth =
    month.getUTCFullYear() === anchorDate.getUTCFullYear() &&
    month.getUTCMonth() === anchorDate.getUTCMonth();

  return (
    <div ref={isAnchorMonth ? anchorRowRef : undefined}>
      <div className="sticky top-0 z-10 bg-[rgba(20,20,22,0.96)] py-1 text-[10px] font-semibold text-white tracking-wide">
        {MONTH_LABEL_FORMATTER.format(month)}
      </div>
      <div className="grid grid-cols-7 gap-0.5 pb-1">
        {blanks.map((_, i) => (
          <div key={`blank-${i}`} />
        ))}
        {days.map((d) => {
          const iso = isoDay(d);
          const isSelected = !!selectedDate && sameDay(d, selectedDate);
          const isHighlighted = sameDay(d, highlightedDate);
          const isToday = sameDay(d, today);
          return (
            <button
              key={iso}
              type="button"
              data-testid={`day-${iso}`}
              data-selected={isSelected ? "true" : "false"}
              data-highlighted={isHighlighted ? "true" : "false"}
              data-today={isToday ? "true" : "false"}
              onMouseEnter={() => onHighlight(d)}
              onClick={() => onCommit(d)}
              className={[
                "text-[10px] rounded-[3px] py-0.5 text-center cursor-pointer outline-none",
                isSelected
                  ? "bg-brett-gold text-black font-bold"
                  : isHighlighted
                    ? "bg-white/10 text-white"
                    : "text-white/85 hover:bg-white/5",
                isToday && !isSelected
                  ? "ring-1 ring-brett-gold/60 ring-inset"
                  : "",
              ].join(" ")}
            >
              {d.getUTCDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}
