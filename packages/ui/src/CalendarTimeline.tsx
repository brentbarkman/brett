import React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { CalendarEventDisplay } from "@brett/types";

interface CalendarTimelineProps {
  events: CalendarEventDisplay[];
  onEventClick: (event: CalendarEventDisplay) => void;
}

export function CalendarTimeline({
  events,
  onEventClick,
}: CalendarTimelineProps) {
  const startHour = 8;
  const endHour = 18;
  const totalHours = endHour - startHour;
  const hourHeight = 60;
  const hours = Array.from({ length: totalHours + 1 }, (_, i) => startHour + i);

  const getEventStyle = (event: CalendarEventDisplay) => {
    const [h, m] = event.startTime.split(":").map(Number);
    const startOffset = (h - startHour + m / 60) * hourHeight;
    const height = (event.durationMinutes / 60) * hourHeight;
    return {
      top: `${startOffset}px`,
      height: `${height}px`,
      className: `${event.color.bg} ${event.color.border} ${event.color.text}`,
    };
  };

  // Mock current time (10:45 AM)
  const currentHour = 10;
  const currentMinute = 45;
  const currentTimeOffset =
    (currentHour - startHour + currentMinute / 60) * hourHeight;

  return (
    <div className="flex flex-col h-full bg-black/30 backdrop-blur-xl rounded-xl border border-white/10 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-white/10">
        <h2 className="text-white font-medium">Today, Jan 15</h2>
        <div className="flex items-center gap-1">
          <button className="p-1 text-white/50 hover:text-white hover:bg-white/10 rounded">
            <ChevronLeft size={16} />
          </button>
          <button className="p-1 text-white/50 hover:text-white hover:bg-white/10 rounded">
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      {/* Timeline Scroll Area */}
      <div className="flex-1 overflow-y-auto relative scrollbar-hide">
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
                  {hour === 12
                    ? "12 PM"
                    : hour > 12
                      ? `${hour - 12} PM`
                      : `${hour} AM`}
                </span>
              </div>
              <div className="flex-1 border-t border-white/5" />
            </div>
          ))}

          {/* Current Time Indicator */}
          <div
            className="absolute left-12 right-0 flex items-center z-20 pointer-events-none"
            style={{ top: `${currentTimeOffset}px` }}
          >
            <div className="w-2 h-2 rounded-full bg-red-500 -ml-1" />
            <div className="flex-1 border-t border-red-500/50" />
          </div>

          {/* Events Container */}
          <div className="absolute top-0 left-12 right-4 bottom-0">
            {events.map((event) => {
              const style = getEventStyle(event);
              return (
                <div
                  key={event.id}
                  onClick={() => onEventClick(event)}
                  className={`
                    absolute left-0 right-0 rounded-md border-l-2 p-2 cursor-pointer
                    hover:brightness-125 transition-all duration-200 overflow-hidden
                    ${style.className}
                  `}
                  style={{ top: style.top, height: style.height }}
                >
                  <div className="flex justify-between items-start">
                    <h4 className="text-xs font-semibold truncate pr-4">
                      {event.title}
                    </h4>
                    {event.hasBrettContext && (
                      <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse shadow-[0_0_5px_rgba(96,165,250,0.8)] flex-shrink-0 mt-1" />
                    )}
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
    </div>
  );
}
