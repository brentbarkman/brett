import React, { useState } from "react";
import type { CalendarEventRecord } from "@brett/types";
import { getEventGlassColor } from "@brett/utils";

export interface CalendarMonthViewProps {
  month: Date;
  events: CalendarEventRecord[];
  onEventClick: (event: CalendarEventRecord) => void;
  onDayClick: (date: Date) => void;
}

const MAX_VISIBLE_EVENTS = 3;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function getMonthGrid(month: Date): Date[][] {
  const year = month.getFullYear();
  const m = month.getMonth();
  const firstDay = new Date(year, m, 1);
  const lastDay = new Date(year, m + 1, 0);

  const startOffset = firstDay.getDay(); // 0 = Sunday
  const totalDays = lastDay.getDate();
  const totalCells = Math.ceil((startOffset + totalDays) / 7) * 7;

  const weeks: Date[][] = [];
  let week: Date[] = [];

  for (let i = 0; i < totalCells; i++) {
    const d = new Date(year, m, 1 - startOffset + i);
    week.push(d);
    if (week.length === 7) {
      weeks.push(week);
      week = [];
    }
  }

  return weeks;
}

function formatTime(isoStr: string): string {
  const d = new Date(isoStr);
  const h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? "p" : "a";
  const hour = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return m === 0 ? `${hour}${ampm}` : `${hour}:${m.toString().padStart(2, "0")}${ampm}`;
}

export function CalendarMonthView({ month, events, onEventClick, onDayClick }: CalendarMonthViewProps) {
  const today = new Date();
  const weeks = getMonthGrid(month);
  const currentMonth = month.getMonth();

  // Index events by day key
  const eventsByDay = new Map<string, CalendarEventRecord[]>();
  for (const event of events) {
    const d = new Date(event.startTime);
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    const arr = eventsByDay.get(key) ?? [];
    arr.push(event);
    eventsByDay.set(key, arr);
  }

  return (
    <div className="flex flex-col h-full">
      {/* Weekday headers */}
      <div className="grid grid-cols-7 border-b border-white/10">
        {WEEKDAYS.map((day) => (
          <div key={day} className="text-center py-2">
            <span className="text-[10px] text-white/40 font-medium uppercase tracking-wider">
              {day}
            </span>
          </div>
        ))}
      </div>

      {/* Weeks grid */}
      <div className="flex-1 grid" style={{ gridTemplateRows: `repeat(${weeks.length}, 1fr)` }}>
        {weeks.map((week, wi) => (
          <div key={wi} className="grid grid-cols-7 border-b border-white/5">
            {week.map((day) => {
              const isCurrentMonth = day.getMonth() === currentMonth;
              const isToday = isSameDay(day, today);
              const key = `${day.getFullYear()}-${day.getMonth()}-${day.getDate()}`;
              const dayEvents = eventsByDay.get(key) ?? [];
              const visibleEvents = dayEvents.slice(0, MAX_VISIBLE_EVENTS);
              const overflowCount = dayEvents.length - MAX_VISIBLE_EVENTS;

              return (
                <div
                  key={key}
                  onClick={() => onDayClick(day)}
                  className={`border-r border-white/5 last:border-r-0 p-1 min-h-[80px] cursor-pointer hover:bg-white/5 transition-colors ${
                    !isCurrentMonth ? "opacity-30" : ""
                  }`}
                >
                  {/* Day number */}
                  <div className="flex justify-end mb-0.5">
                    <span
                      className={`text-xs font-medium w-6 h-6 flex items-center justify-center rounded-full ${
                        isToday
                          ? "bg-brett-gold text-white"
                          : "text-white/60"
                      }`}
                    >
                      {day.getDate()}
                    </span>
                  </div>

                  {/* Event pills */}
                  <div className="space-y-0.5">
                    {visibleEvents.map((event) => {
                      const ec = getEventGlassColor(event.calendarColor);
                      return (
                      <button
                        key={event.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          onEventClick(event);
                        }}
                        className="w-full text-left rounded px-1 py-0.5 text-[10px] font-medium truncate cursor-pointer hover:brightness-125 transition-all leading-tight"
                        style={{
                          backgroundColor: ec.bg,
                          color: ec.text,
                        }}
                      >
                        {!event.isAllDay && (
                          <span className="opacity-60 mr-0.5">{formatTime(event.startTime)}</span>
                        )}
                        {event.title}
                      </button>
                      );
                    })}
                    {overflowCount > 0 && (
                      <div className="text-[9px] text-white/40 font-medium px-1">
                        +{overflowCount} more
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
