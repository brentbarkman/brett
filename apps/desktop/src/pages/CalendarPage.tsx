import React, { useState, useEffect } from "react";
import { CalendarDays } from "lucide-react";
import type { CalendarEventRecord } from "@brett/types";
import { useCalendarEvents } from "../api/calendar";
import { useCalendarAccounts, useConnectCalendar, useToggleCalendarVisibility } from "../api/calendar-accounts";
import { CalendarConnectModal } from "../components/CalendarConnectModal";
import { CalendarHeader, getSunday, type CalendarView, type CalendarInfo } from "../components/calendar/CalendarHeader";
import { CalendarDayView } from "../components/calendar/CalendarDayView";
import { CalendarWeekView } from "../components/calendar/CalendarWeekView";
import { CalendarMonthView } from "../components/calendar/CalendarMonthView";

interface CalendarPageProps {
  onEventClick: (event: CalendarEventRecord) => void;
}

/** Convert a local Date to an ISO timestamp for API queries.
 * Always send full ISO strings — never date-only strings like "2026-03-29" —
 * because the API would interpret them as UTC midnight, shifting day boundaries. */
function toISOParam(d: Date): string {
  return d.toISOString();
}

export default function CalendarPage({ onEventClick }: CalendarPageProps) {
  const { data: accounts = [], isLoading: isLoadingAccounts } = useCalendarAccounts();
  const connectCalendar = useConnectCalendar();
  const toggleVisibility = useToggleCalendarVisibility();
  const [showConnectModal, setShowConnectModal] = useState(false);

  // Flatten all calendars from all accounts for the header dropdown
  const allCalendars: CalendarInfo[] = accounts.flatMap((a) =>
    a.calendars.map((cal) => ({
      id: cal.id,
      name: cal.name,
      color: cal.color,
      isVisible: cal.isVisible,
      accountId: a.id,
    })),
  );

  const [view, setView] = useState<CalendarView>(() => {
    const stored = localStorage.getItem("brett-calendar-view");
    return (["day", "5day", "week", "month"].includes(stored ?? "") ? stored : "week") as CalendarView;
  });
  const [currentDate, setCurrentDate] = useState(new Date());

  useEffect(() => {
    localStorage.setItem("brett-calendar-view", view);
  }, [view]);

  // Compute date range based on view
  const { startDate, endDate } = (() => {
    if (view === "day") {
      const start = new Date(currentDate);
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setDate(end.getDate() + 1);
      return { startDate: toISOParam(start), endDate: toISOParam(end) };
    }

    if (view === "5day") {
      const start = new Date(currentDate);
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setDate(end.getDate() + 5);
      return { startDate: toISOParam(start), endDate: toISOParam(end) };
    }

    if (view === "week") {
      const monday = getSunday(currentDate);
      const end = new Date(monday);
      end.setDate(end.getDate() + 7);
      return { startDate: toISOParam(monday), endDate: toISOParam(end) };
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
    return { startDate: toISOParam(start), endDate: toISOParam(end) };
  })();

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
          {/* Week header — ghost with real dates */}
          <div className="flex border-b border-white/10">
            <div className="w-14 flex-shrink-0" />
            {ghostDays.map((day, i) => {
              const now = new Date();
              const currentDow = now.getDay();
              const diff = i - currentDow;
              const date = new Date(now);
              date.setDate(date.getDate() + diff);
              const dayNum = date.getDate();
              const isToday = i === todayDow;

              return (
                <div key={day} className={`flex-1 py-2 text-center ${i < 6 ? "border-r border-white/5" : ""}`}>
                  <div className={`text-[10px] font-medium uppercase tracking-wider ${isToday ? "text-white/60" : "text-white/30"}`}>
                    {day}
                  </div>
                  <div className={`text-lg font-semibold mt-0.5 ${isToday ? "text-brett-gold" : "text-white/20"}`}>
                    {dayNum}
                  </div>
                </div>
              );
            })}
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
                        onClick={() => setShowConnectModal(true)}
                        className="absolute left-0 right-0 rounded-lg border border-brett-gold/30 px-2.5 py-2 text-left cursor-pointer transition-all hover:brightness-125 hover:border-brett-gold/50 group bg-brett-gold/10 backdrop-blur-xl"
                        style={{
                          top: `${ctaTop}px`,
                          height: `${1.5 * gh}px`,
                        }}
                      >
                        <div className="flex items-start gap-2">
                          <div className="w-6 h-6 rounded-full bg-brett-gold/20 border border-brett-gold/30 flex items-center justify-center flex-shrink-0 mt-0.5">
                            <CalendarDays size={12} className="text-brett-gold" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <span className="text-[10px] font-semibold text-brett-gold block">Connect your calendar</span>
                            <span className="text-[9px] text-white/40 block mt-0.5">Summaries, alerts & RSVP</span>
                            <span className="text-[8px] text-brett-gold/60 font-medium mt-1 block group-hover:text-brett-gold-dark transition-colors">
                              Click to connect →
                            </span>
                          </div>
                        </div>
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
        calendars={allCalendars}
        onToggleCalendar={(accountId, calendarId, isVisible) =>
          toggleVisibility.mutate({ accountId, calendarId, isVisible })
        }
      />

      <div className="flex-1 min-h-0 bg-black/30 backdrop-blur-xl rounded-xl border border-white/10 overflow-hidden">
        {view === "day" && (
          <CalendarDayView
            date={currentDate}
            events={events}
            onEventClick={onEventClick}
          />
        )}
        {(view === "5day" || view === "week") && (
          <CalendarWeekView
            startDate={view === "5day" ? currentDate : getSunday(currentDate)}
            daysPerWeek={view === "5day" ? 5 : 7}
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

      {showConnectModal && (
        <CalendarConnectModal
          onConnect={(meetingNotes) => {
            setShowConnectModal(false);
            connectCalendar.mutate(meetingNotes);
          }}
          onCancel={() => setShowConnectModal(false)}
          isPending={connectCalendar.isPending}
        />
      )}
    </div>
  );
}
