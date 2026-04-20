import React, { useEffect, useRef, useState } from "react";
import { Video } from "lucide-react";
import type { CalendarEventRecord } from "@brett/types";
import { getEventGlassColor, isSafeUrl } from "@brett/utils";

export interface CalendarDayViewProps {
  date: Date;
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

interface LayoutInfo {
  column: number;
  totalColumns: number;
}

function layoutEvents(events: CalendarEventRecord[]): Map<string, LayoutInfo> {
  const timed = events
    .filter((e) => !e.isAllDay)
    .sort((a, b) => parseToMinutes(a.startTime) - parseToMinutes(b.startTime));

  const layout = new Map<string, LayoutInfo>();
  const columns: number[] = [];

  for (const event of timed) {
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

  // Compute totalColumns per overlap group
  for (const event of timed) {
    const start = parseToMinutes(event.startTime);
    const end = start + durationMinutes(event.startTime, event.endTime);
    const entry = layout.get(event.id)!;
    let maxCol = entry.column + 1;

    for (const other of timed) {
      if (other.id === event.id) continue;
      const oStart = parseToMinutes(other.startTime);
      const oEnd = oStart + durationMinutes(other.startTime, other.endTime);
      if (oStart < end && start < oEnd) {
        maxCol = Math.max(maxCol, layout.get(other.id)!.column + 1);
      }
    }
    entry.totalColumns = Math.max(entry.totalColumns, maxCol);
  }

  // Normalize within groups
  for (const event of timed) {
    const start = parseToMinutes(event.startTime);
    const end = start + durationMinutes(event.startTime, event.endTime);
    const entry = layout.get(event.id)!;
    let groupMax = entry.totalColumns;

    for (const other of timed) {
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

export function CalendarDayView({ date, events, onEventClick }: CalendarDayViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [currentTime, setCurrentTime] = useState(new Date());

  const allDayEvents = events.filter((e) => e.isAllDay);
  const timedEvents = events.filter((e) => !e.isAllDay);
  const layout = layoutEvents(timedEvents);
  const hours = Array.from({ length: TOTAL_HOURS }, (_, i) => i);

  // Real-time clock
  useEffect(() => {
    const interval = setInterval(() => setCurrentTime(new Date()), 60000);
    return () => clearInterval(interval);
  }, []);

  // Scroll to 8am on mount
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 8 * HOUR_HEIGHT - 40;
    }
  }, []);

  const isToday =
    date.toDateString() === currentTime.toDateString();
  const currentMinutes = currentTime.getHours() * 60 + currentTime.getMinutes();
  const currentTimeOffset = (currentMinutes / 60) * HOUR_HEIGHT;

  return (
    <div className="flex flex-col h-full">
      {/* All-day strip */}
      {allDayEvents.length > 0 && (
        <div className="flex items-center gap-2 px-4 py-2 border-b border-white/10 overflow-x-auto">
          <span className="text-[10px] text-white/30 font-medium uppercase tracking-wider flex-shrink-0 w-12 text-right pr-2">
            All day
          </span>
          <div className="flex gap-1.5 flex-wrap">
            {allDayEvents.map((event) => {
              const ec = getEventGlassColor(event.calendarColor);
              return (
              <button
                key={event.id}
                onClick={() => onEventClick(event)}
                className="px-2.5 py-1 rounded-md text-xs font-medium cursor-pointer hover:brightness-125 transition-all truncate max-w-[200px]"
                style={{
                  backgroundColor: ec.bg,
                  borderLeft: `2px solid ${ec.border}`,
                  color: ec.text,
                }}
              >
                {event.title}
              </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Time grid */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto relative scrollbar-hide">
        <div
          className="relative"
          style={{ height: `${TOTAL_HOURS * HOUR_HEIGHT}px` }}
        >
          {/* Hour grid lines */}
          {hours.map((hour) => (
            <div
              key={hour}
              className="absolute w-full flex items-start"
              style={{ top: `${hour * HOUR_HEIGHT}px` }}
            >
              <div className="w-14 text-right pr-2 -mt-2.5">
                <span className="text-[10px] text-white/30 font-medium">
                  {formatHourLabel(hour)}
                </span>
              </div>
              <div className="flex-1 border-t border-white/5" />
            </div>
          ))}

          {/* Current time line */}
          {isToday && (
            <div
              className="absolute left-14 right-0 flex items-center z-20 pointer-events-none"
              style={{ top: `${currentTimeOffset}px` }}
            >
              <div className="w-2 h-2 rounded-full bg-red-500 -ml-1" />
              <div className="flex-1 border-t border-red-500/60" />
            </div>
          )}

          {/* Events container */}
          <div className="absolute top-0 left-14 right-4 bottom-0">
            {timedEvents.map((event) => {
              const startMin = parseToMinutes(event.startTime);
              const dur = durationMinutes(event.startTime, event.endTime);
              const top = (startMin / 60) * HOUR_HEIGHT;
              const height = (dur / 60) * HOUR_HEIGHT;
              const info = layout.get(event.id);
              const col = info?.column ?? 0;
              const total = info?.totalColumns ?? 1;
              const widthPct = 100 / total;
              const leftPct = col * widthPct;
              const ec = getEventGlassColor(event.calendarColor);

              return (
                <div
                  key={event.id}
                  onClick={() => onEventClick(event)}
                  className="absolute rounded-md border-l-2 p-2 cursor-pointer hover:brightness-125 transition-all duration-200 overflow-hidden"
                  style={{
                    top: `${top}px`,
                    height: `${Math.max(height, 20)}px`,
                    left: `${leftPct}%`,
                    width: `${widthPct}%`,
                    backgroundColor: ec.bg,
                    borderLeftColor: ec.border,
                    color: ec.text,
                  }}
                >
                  <div className="flex justify-between items-start">
                    <h4 className="text-xs font-semibold truncate pr-2">
                      {event.title}
                    </h4>
                    {event.meetingLink && isSafeUrl(event.meetingLink) && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          window.open(event.meetingLink!, "_blank");
                        }}
                        className="p-0.5 rounded hover:bg-white/10 transition-colors flex-shrink-0"
                        title="Join meeting"
                      >
                        <Video size={12} className="opacity-70" />
                      </button>
                    )}
                  </div>
                  {dur >= 30 && (
                    <p className="text-[10px] opacity-70 truncate mt-0.5">
                      {event.location || (event.attendees?.length ? `${event.attendees.length} attendees` : "")}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
