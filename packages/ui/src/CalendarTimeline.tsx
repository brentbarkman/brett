import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Video, X } from "lucide-react";
import type {
  CalendarEventDisplay,
  CalendarRsvpStatus,
} from "@brett/types";

// TODO: Import EventHoverTooltip once available
// import { EventHoverTooltip } from "./EventHoverTooltip";

interface CalendarTimelineProps {
  events: CalendarEventDisplay[];
  onEventClick: (event: CalendarEventDisplay) => void;
  onQuickRsvp?: (eventId: string, status: CalendarRsvpStatus) => void;
  isLoading?: boolean;
  onConnect?: () => void;
  onDismiss?: () => void;
  date?: Date;
  onPrevDay?: () => void;
  onNextDay?: () => void;
  onToday?: () => void;
}

interface ContextMenuState {
  eventId: string;
  x: number;
  y: number;
}

/** Parse "HH:MM" or ISO string to minutes since midnight */
function parseTimeToMinutes(timeStr: string): number {
  // Handle ISO strings
  if (timeStr.includes("T")) {
    const d = new Date(timeStr);
    return d.getHours() * 60 + d.getMinutes();
  }
  const [h, m] = timeStr.split(":").map(Number);
  return h * 60 + m;
}

/** Detect overlapping event groups and assign column positions */
function layoutEvents(events: CalendarEventDisplay[]) {
  const sorted = [...events].sort(
    (a, b) => parseTimeToMinutes(a.startTime) - parseTimeToMinutes(b.startTime)
  );

  const layout: Map<
    string,
    { column: number; totalColumns: number }
  > = new Map();

  // Track active columns: each entry is the end time (in minutes) of the event in that column
  const columns: number[] = [];

  for (const event of sorted) {
    const start = parseTimeToMinutes(event.startTime);
    const end = start + event.durationMinutes;

    // Find the first available column (one whose event has ended)
    let placed = false;
    for (let i = 0; i < columns.length; i++) {
      if (columns[i] <= start) {
        columns[i] = end;
        layout.set(event.id, { column: i, totalColumns: 0 }); // totalColumns set later
        placed = true;
        break;
      }
    }
    if (!placed) {
      layout.set(event.id, { column: columns.length, totalColumns: 0 });
      columns.push(end);
    }
  }

  // Now determine totalColumns for each overlapping group
  // Re-scan: for each event, find how many columns overlap at its time
  for (const event of sorted) {
    const start = parseTimeToMinutes(event.startTime);
    const end = start + event.durationMinutes;

    let maxCols = 1;
    for (const other of sorted) {
      if (other.id === event.id) continue;
      const oStart = parseTimeToMinutes(other.startTime);
      const oEnd = oStart + other.durationMinutes;
      // Overlap check
      if (oStart < end && start < oEnd) {
        const entry = layout.get(other.id)!;
        const myEntry = layout.get(event.id)!;
        maxCols = Math.max(maxCols, entry.column + 1, myEntry.column + 1);
      }
    }

    const entry = layout.get(event.id)!;
    entry.totalColumns = Math.max(entry.totalColumns, maxCols);
  }

  // Second pass: normalize totalColumns within each overlap group
  for (const event of sorted) {
    const start = parseTimeToMinutes(event.startTime);
    const end = start + event.durationMinutes;
    const entry = layout.get(event.id)!;

    // Find max totalColumns among all overlapping events
    let groupMax = entry.totalColumns;
    for (const other of sorted) {
      if (other.id === event.id) continue;
      const oStart = parseTimeToMinutes(other.startTime);
      const oEnd = oStart + other.durationMinutes;
      if (oStart < end && start < oEnd) {
        groupMax = Math.max(groupMax, layout.get(other.id)!.totalColumns);
      }
    }
    entry.totalColumns = groupMax;
  }

  return layout;
}

/** Find buffer gaps between consecutive non-overlapping events */
function findBuffers(events: CalendarEventDisplay[]) {
  const sorted = [...events].sort(
    (a, b) => parseTimeToMinutes(a.startTime) - parseTimeToMinutes(b.startTime)
  );

  const buffers: { afterEventId: string; gapMinutes: number; topOffset: number }[] = [];

  for (let i = 0; i < sorted.length - 1; i++) {
    const curr = sorted[i];
    const next = sorted[i + 1];
    const currEnd = parseTimeToMinutes(curr.startTime) + curr.durationMinutes;
    const nextStart = parseTimeToMinutes(next.startTime);
    const gap = nextStart - currEnd;

    if (gap >= 0 && gap < 15) {
      buffers.push({
        afterEventId: curr.id,
        gapMinutes: gap,
        topOffset: currEnd, // in minutes from midnight
      });
    }
  }

  return buffers;
}

export function CalendarTimeline({
  events,
  onEventClick,
  onQuickRsvp,
  isLoading,
  onConnect,
  onDismiss,
  date,
  onPrevDay,
  onNextDay,
  onToday,
}: CalendarTimelineProps) {
  // Empty state: real-looking timeline with ghost events + one live CTA at current time
  if (!isLoading && events.length === 0 && onConnect && onDismiss) {
    const now = new Date();
    const ghostToday = now.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
    const gh = 60; // hourHeight
    const s = 8; // startHour
    const totalH = 10;
    const ghostHours = Array.from({ length: totalH + 1 }, (_, i) => s + i);
    const nowH = now.getHours();
    const nowM = now.getMinutes();
    const nowOffset = ((nowH - s) + nowM / 60) * gh;

    // Place the "live" CTA event at the current hour, clamped to working hours
    const ctaHour = Math.max(s, Math.min(nowH, s + totalH - 2));
    const ctaTop = (ctaHour - s) * gh + (nowM > 30 ? 30 : 0);

    // Ghost events — a full realistic day, positioned to avoid the CTA slot
    const ghostEvents = [
      { top: 0 * gh, h: 0.5 * gh, label: "Daily standup", bg: "rgba(59,130,246,0.12)", border: "rgba(59,130,246,0.25)", text: "rgb(147,197,253)" },
      { top: 0.75 * gh, h: 1.25 * gh, label: "Sprint planning", bg: "rgba(34,197,94,0.12)", border: "rgba(34,197,94,0.25)", text: "rgb(134,239,172)" },
      { top: 2.5 * gh, h: 0.5 * gh, label: "Coffee chat w/ Alex", bg: "rgba(245,158,11,0.12)", border: "rgba(245,158,11,0.25)", text: "rgb(252,211,77)" },
      { top: 3.5 * gh, h: 1 * gh, label: "Lunch", bg: "rgba(249,115,22,0.10)", border: "rgba(249,115,22,0.22)", text: "rgb(253,186,116)" },
      { top: 5 * gh, h: 2 * gh, label: "Deep work", bg: "rgba(168,85,247,0.10)", border: "rgba(168,85,247,0.22)", text: "rgb(216,180,254)" },
      { top: 7.5 * gh, h: 0.75 * gh, label: "Design review", bg: "rgba(6,182,212,0.10)", border: "rgba(6,182,212,0.22)", text: "rgb(103,232,249)" },
      { top: 8.5 * gh, h: 0.5 * gh, label: "1:1 w/ manager", bg: "rgba(99,102,241,0.10)", border: "rgba(99,102,241,0.22)", text: "rgb(165,180,252)" },
      { top: 9.25 * gh, h: 0.75 * gh, label: "Retro", bg: "rgba(236,72,153,0.10)", border: "rgba(236,72,153,0.22)", text: "rgb(249,168,212)" },
    ].filter((evt) => {
      // Remove any ghost event that overlaps with the CTA
      const ctaBottom = ctaTop + 1.5 * gh;
      return evt.top + evt.h <= ctaTop || evt.top >= ctaBottom;
    });

    return (
      <div className="flex flex-col h-full bg-black/30 backdrop-blur-xl rounded-xl border border-white/10 overflow-hidden relative">
        {/* Header — looks real */}
        <div className="flex items-center justify-between p-4 border-b border-white/10">
          <div className="flex items-center gap-2">
            <h2 className="text-white font-medium">{ghostToday}</h2>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={onDismiss}
              className="p-1 text-white/30 hover:text-white/60 transition-colors rounded"
              title="Hide calendar"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {/* Timeline */}
        <div className="flex-1 overflow-y-auto relative scrollbar-hide">
          <div className="relative" style={{ height: `${totalH * gh}px` }}>
            {/* Hour grid — fully visible */}
            {ghostHours.map((hour, i) => (
              <div key={hour} className="absolute w-full flex items-start" style={{ top: `${i * gh}px` }}>
                <div className="w-12 text-right pr-2 -mt-2.5">
                  <span className="text-[10px] text-white/30 font-medium">
                    {hour === 12 ? "12 PM" : hour > 12 ? `${hour - 12} PM` : `${hour} AM`}
                  </span>
                </div>
                <div className="flex-1 border-t border-white/5" />
              </div>
            ))}

            {/* Current time line */}
            {nowH >= s && nowH < s + totalH && (
              <div className="absolute left-12 right-0 flex items-center z-20 pointer-events-none" style={{ top: `${nowOffset}px` }}>
                <div className="w-2 h-2 rounded-full bg-red-500 -ml-1" />
                <div className="flex-1 border-t border-red-500/50" />
              </div>
            )}

            {/* Ghost events — slightly faded to hint they're placeholders */}
            <div className="absolute top-0 left-12 right-4 bottom-0">
              {ghostEvents.map((evt, i) => (
                <div
                  key={i}
                  className="absolute left-0 right-0 rounded-md border-l-2 px-2.5 py-1.5 opacity-50 select-none"
                  style={{ top: `${evt.top}px`, height: `${evt.h}px`, backgroundColor: evt.bg, borderLeftColor: evt.border }}
                >
                  <span className="text-[10px] font-semibold" style={{ color: evt.text }}>{evt.label}</span>
                </div>
              ))}

              {/* Live CTA event — prominent, clickable */}
              <button
                onClick={onConnect}
                className="absolute left-0 right-0 rounded-lg border border-blue-500/30 px-3 py-2.5 text-left cursor-pointer transition-all hover:brightness-125 hover:border-blue-500/50 group bg-blue-500/10 backdrop-blur-xl"
                style={{
                  top: `${ctaTop}px`,
                  height: `${1.5 * gh}px`,
                }}
              >
                <div className="flex items-start gap-2.5">
                  <div className="w-7 h-7 rounded-full bg-blue-500/20 border border-blue-500/30 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <CalendarDays size={14} className="text-blue-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="text-[11px] font-semibold text-blue-300 block">Connect your calendar</span>
                    <span className="text-[10px] text-white/40 block mt-0.5">See your real schedule, summaries & alerts</span>
                    <span className="text-[9px] text-blue-400/70 font-medium mt-1.5 block group-hover:text-blue-300 transition-colors">
                      Click to connect Google Calendar →
                    </span>
                  </div>
                </div>
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const startHour = 0;
  const endHour = 24;
  const totalHours = endHour - startHour;
  const hourHeight = 60;
  const hours = Array.from({ length: totalHours + 1 }, (_, i) => startHour + i);

  // Real-time current time
  const [currentTime, setCurrentTime] = useState(new Date());
  useEffect(() => {
    const interval = setInterval(() => setCurrentTime(new Date()), 60000);
    return () => clearInterval(interval);
  }, []);

  const currentHour = currentTime.getHours();
  const currentMinute = currentTime.getMinutes();
  const currentTimeOffset =
    (currentHour - startHour + currentMinute / 60) * hourHeight;

  // Auto-scroll to current time on mount
  const currentTimeRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (currentTimeRef.current) {
      currentTimeRef.current.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    }
  }, []);

  // Context menu state
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  // Close context menu on click outside or Escape
  useEffect(() => {
    if (!contextMenu) return;
    const clickHandler = () => setContextMenu(null);
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setContextMenu(null);
    };
    window.addEventListener("click", clickHandler);
    window.addEventListener("keydown", keyHandler);
    return () => {
      window.removeEventListener("click", clickHandler);
      window.removeEventListener("keydown", keyHandler);
    };
  }, [contextMenu]);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, event: CalendarEventDisplay) => {
      if (!onQuickRsvp) return;
      e.preventDefault();
      e.stopPropagation();
      setContextMenu({ eventId: event.id, x: e.clientX, y: e.clientY });
    },
    [onQuickRsvp]
  );

  const handleRsvp = useCallback(
    (status: CalendarRsvpStatus) => {
      if (contextMenu && onQuickRsvp) {
        onQuickRsvp(contextMenu.eventId, status);
      }
      setContextMenu(null);
    },
    [contextMenu, onQuickRsvp]
  );

  // Layout computation (memoized to avoid O(n²) recalc on unrelated re-renders)
  const layout = useMemo(() => layoutEvents(events), [events]);
  const buffers = useMemo(() => findBuffers(events), [events]);

  // Countdown: find next upcoming event (only for today's view)
  const nowMinutes = currentHour * 60 + currentMinute;
  const displayDate = date ?? currentTime;
  const isToday = displayDate.toDateString() === currentTime.toDateString();
  const sortedEvents = [...events].sort(
    (a, b) => parseTimeToMinutes(a.startTime) - parseTimeToMinutes(b.startTime)
  );

  let countdownEvent: CalendarEventDisplay | null = null;
  let countdownText: string | null = null;

  if (isToday) {
    for (const ev of sortedEvents) {
      const evStart = parseTimeToMinutes(ev.startTime);
      const evEnd = evStart + ev.durationMinutes;

      if (evStart > nowMinutes) {
        // Upcoming
        const diff = evStart - nowMinutes;
        countdownEvent = ev;
        countdownText = `Starts in ${diff} min`;
        break;
      } else if (nowMinutes >= evStart && nowMinutes < evEnd) {
        // Currently happening
        countdownEvent = ev;
        countdownText = "Now";
        break;
      }
    }
  }

  const getEventStyle = (event: CalendarEventDisplay) => {
    const startMin = parseTimeToMinutes(event.startTime);
    const startOffset = ((startMin - startHour * 60) / 60) * hourHeight;
    const height = (event.durationMinutes / 60) * hourHeight;
    const info = layout.get(event.id);
    const column = info?.column ?? 0;
    const totalColumns = info?.totalColumns ?? 1;
    const isOverlapping = totalColumns > 1;
    const widthPercent = 100 / totalColumns;
    const leftPercent = column * widthPercent;

    return {
      top: `${startOffset}px`,
      height: `${height}px`,
      left: `${leftPercent}%`,
      width: `${widthPercent}%`,
      isOverlapping,
    };
  };

  // Format displayed date
  const dateLabel = displayDate.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const isDisplayToday = isToday;

  return (
    <div className="flex flex-col h-full bg-black/30 backdrop-blur-xl rounded-xl border border-white/10 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-white/10">
        <div className="flex items-center gap-2">
          {isDisplayToday ? (
            <h2 className="text-white font-medium">{dateLabel}</h2>
          ) : (
            <button onClick={onToday} className="text-white font-medium hover:text-blue-400 transition-colors" title="Back to today">
              {dateLabel}
            </button>
          )}
          {!isDisplayToday && onToday && (
            <button onClick={onToday} className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-500/15 text-blue-400 font-medium hover:bg-blue-500/25 transition-colors">
              Today
            </button>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button onClick={onPrevDay} className="p-1 text-white/50 hover:text-white hover:bg-white/10 rounded transition-colors">
            <ChevronLeft size={16} />
          </button>
          <button onClick={onNextDay} className="p-1 text-white/50 hover:text-white hover:bg-white/10 rounded transition-colors">
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      {/* Loading state */}
      {isLoading && (
        <div className="flex items-center justify-center py-8">
          <div className="w-5 h-5 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
        </div>
      )}

      {/* Timeline Scroll Area */}
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto relative scrollbar-hide">
        <div
          className="relative min-h-[600px]"
          style={{ height: `${totalHours * hourHeight}px` }}
        >
          {/* Background Grid & Labels */}
          {hours.map((hour, i) => (
            <div
              key={hour}
              className="absolute w-full flex items-start"
              style={{ top: `${i * hourHeight}px` }}
            >
              <div className="w-12 text-right pr-2 -mt-2.5">
                <span className="text-[10px] text-white/30 font-medium">
                  {hour === 0 || hour === 24
                    ? "12 AM"
                    : hour === 12
                      ? "12 PM"
                      : hour > 12
                        ? `${hour - 12} PM`
                        : `${hour} AM`}
                </span>
              </div>
              <div className="flex-1 border-t border-white/5" />
            </div>
          ))}

          {/* Current Time Indicator — only on today */}
          {isDisplayToday && (
            <div
              ref={currentTimeRef}
              className="absolute left-12 right-0 flex items-center z-20 pointer-events-none"
              style={{ top: `${currentTimeOffset}px` }}
            >
              <div className="w-2 h-2 rounded-full bg-red-500 -ml-1" />
              <div className="flex-1 border-t border-red-500/50" />
            </div>
          )}

          {/* Buffer indicators */}
          {buffers.map((buf) => {
            const topPx = ((buf.topOffset - startHour * 60) / 60) * hourHeight;
            return (
              <div
                key={`buffer-${buf.afterEventId}`}
                className="absolute left-12 right-4 flex items-center justify-center z-10 pointer-events-none"
                style={{ top: `${topPx}px`, height: "12px" }}
              >
                <span
                  className={`text-[9px] font-medium ${
                    buf.gapMinutes === 0 ? "text-red-400" : "text-amber-400/60"
                  }`}
                >
                  {buf.gapMinutes === 0
                    ? "0 min buffer"
                    : `${buf.gapMinutes} min`}
                </span>
              </div>
            );
          })}

          {/* Events Container */}
          <div className="absolute top-0 left-12 right-4 bottom-0">
            {events.map((event) => {
              const style = getEventStyle(event);
              const isOverlapping = style.isOverlapping;

              return (
                // TODO: Wrap with <EventHoverTooltip event={event} side="left"> once available
                <div
                  key={event.id}
                  onClick={() => onEventClick(event)}
                  onContextMenu={(e) => handleContextMenu(e, event)}
                  className={`
                    absolute rounded-md border-l-2 p-2 cursor-pointer
                    hover:brightness-125 transition-all duration-200 overflow-hidden
                    ${isOverlapping ? "border-amber-500/30" : ""}
                  `}
                  style={{
                    top: style.top,
                    height: style.height,
                    left: style.left,
                    width: style.width,
                    backgroundColor: event.color.bg,
                    borderColor: isOverlapping
                      ? undefined
                      : event.color.border,
                    borderLeftColor: event.color.border,
                    color: event.color.text,
                  }}
                >
                  <div className="flex justify-between items-start">
                    <h4 className="text-xs font-semibold truncate pr-4">
                      {event.title}
                    </h4>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {event.meetingLink && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            window.open(event.meetingLink, "_blank");
                          }}
                          className="p-0.5 rounded hover:bg-white/10 transition-colors"
                          title="Join meeting"
                        >
                          <Video size={12} className="opacity-70" />
                        </button>
                      )}
                      {event.hasBrettContext && (
                        <span className="text-[10px] text-amber-400/60 leading-none mt-0.5" title="Brett's Take available">✦</span>
                      )}
                    </div>
                  </div>
                  {event.durationMinutes >= 30 && (
                    <p className="text-[10px] opacity-70 truncate mt-0.5">
                      {event.location ||
                        (event.attendees
                          ? `${event.attendees.length} attendees`
                          : "")}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Context Menu for Quick RSVP */}
      {contextMenu && (
        <div
          className="fixed z-50 bg-black/80 backdrop-blur-xl border border-white/10 rounded-lg py-1 shadow-2xl"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          {(
            [
              { label: "Accept", status: "accepted" as CalendarRsvpStatus },
              { label: "Tentative", status: "tentative" as CalendarRsvpStatus },
              { label: "Decline", status: "declined" as CalendarRsvpStatus },
            ] as const
          ).map((item) => (
            <button
              key={item.status}
              onClick={() => handleRsvp(item.status)}
              className="w-full text-left px-3 py-1.5 text-xs text-white/80 hover:bg-white/10 transition-colors"
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
