import React, { useEffect, useRef, useState, useMemo } from "react";
import { Video } from "lucide-react";
import type { CalendarEventRecord } from "@brett/types";
import { getEventGlassColor } from "@brett/utils";

export interface CalendarWeekViewProps {
  startDate: Date;
  daysPerWeek: number;
  events: CalendarEventRecord[];
  onEventClick: (event: CalendarEventRecord) => void;
}

const HOUR_HEIGHT = 60;
const TOTAL_HOURS = 24;

function parseToMinutes(isoStr: string): number {
  const d = new Date(isoStr);
  return d.getHours() * 60 + d.getMinutes();
}

function durationMinutes(start: string, end: string): number {
  return Math.max((new Date(end).getTime() - new Date(start).getTime()) / 60000, 15);
}

function formatHourLabel(hour: number): string {
  if (hour === 0) return "12 AM";
  if (hour === 12) return "12 PM";
  return hour > 12 ? `${hour - 12} PM` : `${hour} AM`;
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function getEventDay(event: CalendarEventRecord): string {
  const d = new Date(event.startTime);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

interface LayoutInfo {
  column: number;
  totalColumns: number;
}

function layoutEventsForDay(events: CalendarEventRecord[]): Map<string, LayoutInfo> {
  const sorted = [...events].sort((a, b) => parseToMinutes(a.startTime) - parseToMinutes(b.startTime));
  const layout = new Map<string, LayoutInfo>();
  const columns: number[] = [];

  for (const event of sorted) {
    const start = parseToMinutes(event.startTime);
    const end = start + durationMinutes(event.startTime, event.endTime);
    let placed = false;

    for (let i = 0; i < columns.length; i++) {
      if (columns[i] <= start) {
        columns[i] = end;
        layout.set(event.id, { column: i, totalColumns: 0 });
        placed = true;
        break;
      }
    }
    if (!placed) {
      layout.set(event.id, { column: columns.length, totalColumns: 0 });
      columns.push(end);
    }
  }

  for (const event of sorted) {
    const start = parseToMinutes(event.startTime);
    const end = start + durationMinutes(event.startTime, event.endTime);
    const entry = layout.get(event.id)!;
    let maxCol = entry.column + 1;

    for (const other of sorted) {
      if (other.id === event.id) continue;
      const oStart = parseToMinutes(other.startTime);
      const oEnd = oStart + durationMinutes(other.startTime, other.endTime);
      if (oStart < end && start < oEnd) {
        maxCol = Math.max(maxCol, layout.get(other.id)!.column + 1);
      }
    }
    entry.totalColumns = Math.max(entry.totalColumns, maxCol);
  }

  for (const event of sorted) {
    const start = parseToMinutes(event.startTime);
    const end = start + durationMinutes(event.startTime, event.endTime);
    const entry = layout.get(event.id)!;
    let groupMax = entry.totalColumns;

    for (const other of sorted) {
      if (other.id === event.id) continue;
      const oStart = parseToMinutes(other.startTime);
      const oEnd = oStart + durationMinutes(other.startTime, other.endTime);
      if (oStart < end && start < oEnd) {
        groupMax = Math.max(groupMax, layout.get(other.id)!.totalColumns);
      }
    }
    entry.totalColumns = groupMax;
  }

  return layout;
}

export function CalendarWeekView({ startDate, daysPerWeek, events, onEventClick }: CalendarWeekViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [currentTime, setCurrentTime] = useState(new Date());
  const today = new Date();

  const hours = Array.from({ length: TOTAL_HOURS }, (_, i) => i);

  // Build days array
  const days = useMemo(() => {
    const result: Date[] = [];
    for (let i = 0; i < daysPerWeek; i++) {
      const d = new Date(startDate);
      d.setDate(d.getDate() + i);
      result.push(d);
    }
    return result;
  }, [startDate, daysPerWeek]);

  // Group events by day (memoized)
  const { eventsByDay, allDayByDay, layoutByDay } = useMemo(() => {
    const allDayEvents = events.filter((e) => e.isAllDay);
    const timedEvents = events.filter((e) => !e.isAllDay);

    const ebd = new Map<string, CalendarEventRecord[]>();
    const abd = new Map<string, CalendarEventRecord[]>();

    for (const day of days) {
      const key = `${day.getFullYear()}-${day.getMonth()}-${day.getDate()}`;
      ebd.set(key, []);
      abd.set(key, []);
    }

    for (const event of timedEvents) {
      const key = getEventDay(event);
      ebd.get(key)?.push(event);
    }

    for (const event of allDayEvents) {
      const key = getEventDay(event);
      abd.get(key)?.push(event);
    }

    const lbd = new Map<string, Map<string, LayoutInfo>>();
    for (const [key, dayEvents] of ebd) {
      lbd.set(key, layoutEventsForDay(dayEvents));
    }

    return { eventsByDay: ebd, allDayByDay: abd, layoutByDay: lbd };
  }, [events, days]);

  // Real-time clock
  useEffect(() => {
    const interval = setInterval(() => setCurrentTime(new Date()), 60000);
    return () => clearInterval(interval);
  }, []);

  // Scroll to 8am
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 8 * HOUR_HEIGHT - 40;
    }
  }, []);

  const currentMinutes = currentTime.getHours() * 60 + currentTime.getMinutes();
  const currentTimeOffset = (currentMinutes / 60) * HOUR_HEIGHT;

  const hasAllDay = Array.from(allDayByDay.values()).some((arr) => arr.length > 0);

  return (
    <div className="flex flex-col h-full">
      {/* Column headers */}
      <div className="flex border-b border-white/10">
        {/* Time gutter spacer */}
        <div className="w-14 flex-shrink-0" />
        {days.map((day) => {
          const isCurrentDay = isSameDay(day, today);
          const dayName = day.toLocaleDateString("en-US", { weekday: "short" });
          const dayNum = day.getDate();

          return (
            <div
              key={day.toISOString()}
              className="flex-1 text-center py-2 min-w-0"
            >
              <div className="text-[10px] text-white/40 font-medium uppercase tracking-wider">
                {dayName}
              </div>
              <div
                className={`text-lg font-semibold mt-0.5 ${
                  isCurrentDay
                    ? "text-blue-400 bg-blue-500/20 w-8 h-8 rounded-full flex items-center justify-center mx-auto"
                    : "text-white/80"
                }`}
              >
                {dayNum}
              </div>
            </div>
          );
        })}
      </div>

      {/* All-day strip */}
      {hasAllDay && (
        <div className="flex border-b border-white/10">
          <div className="w-14 flex-shrink-0 text-right pr-2 py-1">
            <span className="text-[9px] text-white/30 font-medium">ALL DAY</span>
          </div>
          {days.map((day) => {
            const key = `${day.getFullYear()}-${day.getMonth()}-${day.getDate()}`;
            const dayAllDay = allDayByDay.get(key) ?? [];
            return (
              <div key={key} className="flex-1 min-w-0 px-0.5 py-1 flex flex-wrap gap-0.5">
                {dayAllDay.map((event) => {
                  const ec = getEventGlassColor(event.calendarColor);
                  return (
                  <button
                    key={event.id}
                    onClick={() => onEventClick(event)}
                    className="px-1.5 py-0.5 rounded text-[10px] font-medium cursor-pointer hover:brightness-125 transition-all truncate w-full text-left"
                    style={{
                      backgroundColor: ec.bg,
                      color: ec.text,
                    }}
                  >
                    {event.title}
                  </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}

      {/* Time grid */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto relative scrollbar-hide">
        <div
          className="relative flex"
          style={{ height: `${TOTAL_HOURS * HOUR_HEIGHT}px` }}
        >
          {/* Time labels gutter */}
          <div className="w-14 flex-shrink-0 relative">
            {hours.map((hour) => (
              <div
                key={hour}
                className="absolute w-full text-right pr-2"
                style={{ top: `${hour * HOUR_HEIGHT - 7}px` }}
              >
                <span className="text-[10px] text-white/30 font-medium">
                  {formatHourLabel(hour)}
                </span>
              </div>
            ))}
          </div>

          {/* Day columns */}
          {days.map((day, dayIndex) => {
            const key = `${day.getFullYear()}-${day.getMonth()}-${day.getDate()}`;
            const dayEvents = eventsByDay.get(key) ?? [];
            const dayLayout = layoutByDay.get(key) ?? new Map();
            const isCurrentDay = isSameDay(day, today);

            return (
              <div
                key={key}
                className={`flex-1 relative min-w-0 ${
                  dayIndex < daysPerWeek - 1 ? "border-r border-white/5" : ""
                }`}
              >
                {/* Hour grid lines */}
                {hours.map((hour) => (
                  <div
                    key={hour}
                    className="absolute w-full border-t border-white/5"
                    style={{ top: `${hour * HOUR_HEIGHT}px` }}
                  />
                ))}

                {/* Current time line */}
                {isCurrentDay && (
                  <div
                    className="absolute left-0 right-0 flex items-center z-20 pointer-events-none"
                    style={{ top: `${currentTimeOffset}px` }}
                  >
                    <div className="w-2 h-2 rounded-full bg-red-500 -ml-1" />
                    <div className="flex-1 border-t border-red-500/60" />
                  </div>
                )}

                {/* Events */}
                <div className="absolute inset-0 px-0.5">
                  {dayEvents.map((event) => {
                    const startMin = parseToMinutes(event.startTime);
                    const dur = durationMinutes(event.startTime, event.endTime);
                    const top = (startMin / 60) * HOUR_HEIGHT;
                    const height = (dur / 60) * HOUR_HEIGHT;
                    const info = dayLayout.get(event.id);
                    const col = info?.column ?? 0;
                    const total = info?.totalColumns ?? 1;
                    const widthPct = 100 / total;
                    const leftPct = col * widthPct;
                    const ec = getEventGlassColor(event.calendarColor);

                    return (
                      <div
                        key={event.id}
                        onClick={() => onEventClick(event)}
                        className="absolute rounded-md border-l-2 p-1 cursor-pointer hover:brightness-125 transition-all duration-200 overflow-hidden"
                        style={{
                          top: `${top}px`,
                          height: `${Math.max(height, 18)}px`,
                          left: `${leftPct}%`,
                          width: `${widthPct}%`,
                          backgroundColor: ec.bg,
                          borderLeftColor: ec.border,
                          color: ec.text,
                        }}
                      >
                        <h4 className="text-[10px] font-semibold truncate leading-tight">
                          {event.title}
                        </h4>
                        {dur >= 45 && event.location && (
                          <p className="text-[9px] opacity-70 truncate mt-0.5">
                            {event.location}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
