import React, { useState } from "react";
import { ExternalLink, MapPin, Clock, Users } from "lucide-react";
import type { CalendarEventDisplay } from "@brett/types";
import type { NextUpTimerState } from "./useNextUpTimer";
import { useDisplayTitle } from "./lib/demoMode";

interface NextUpCardProps {
  event: CalendarEventDisplay;
  timer: NextUpTimerState;
  variant: "compact" | "expanded";
  onEventClick: () => void;
}

export function NextUpCard({ event, timer, variant, onEventClick }: NextUpCardProps) {
  if (variant === "compact") {
    return <CompactCard event={event} timer={timer} onEventClick={onEventClick} />;
  }
  return <ExpandedCard event={event} timer={timer} onEventClick={onEventClick} />;
}

function CompactCard({
  event,
  timer,
  onEventClick,
}: {
  event: CalendarEventDisplay;
  timer: NextUpTimerState;
  onEventClick: () => void;
}) {
  const [isHovered, setIsHovered] = useState(false);
  const isNow = timer.isHappening;
  const shownTitle = useDisplayTitle(event.id, event.title, "calendar");

  return (
    <div
      onClick={onEventClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={`
        bg-black/40 backdrop-blur-md rounded-xl p-3 cursor-pointer
        transition-all duration-200 relative overflow-hidden
        ${isNow ? "border border-emerald-500/25" : "border border-amber-500/25"}
        ${isHovered ? (isNow ? "border-emerald-500/35 shadow-[0_0_20px_rgba(16,185,129,0.08)]" : "border-amber-500/35 shadow-[0_0_20px_rgba(245,158,11,0.08)]") : ""}
      `}
    >
      <div className={`absolute top-0 right-0 w-16 h-16 rounded-full blur-2xl -mr-6 -mt-6 pointer-events-none ${isNow ? "bg-emerald-500/[0.08]" : "bg-amber-500/5"}`} />

      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className={`text-[10px] uppercase tracking-[0.15em] font-semibold ${isNow ? "text-emerald-500/90" : "text-amber-500/90"}`}>
            {isNow ? "Now" : "Up Next"}
          </span>
          {isNow && (
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.6)]" />
          )}
        </div>
        <span className={`text-[11px] font-medium ${isNow ? "text-white/40" : "text-amber-400"} ${!isNow && timer.isUrgent ? "animate-pulse" : ""}`}>
          {timer.label}
        </span>
      </div>

      <div className="text-sm font-semibold text-white mb-1 truncate">{shownTitle}</div>

      <div className="text-[11px] text-white/50 truncate">
        {formatTimeRange(event.startTime, event.endTime)}
        {event.location && (
          <>
            <span className="text-white/20 mx-1">·</span>
            {event.location}
          </>
        )}
      </div>

      {isHovered && (
        <div className="border-t border-white/10 mt-2.5 pt-2.5 space-y-1.5 text-[11px] text-white/50">
          {event.attendees && event.attendees.length > 0 && (
            <div className="flex items-center gap-1.5">
              <Users size={11} className="text-white/30" />
              <span>{event.attendees.map((a) => a.name).join(", ")} + you</span>
            </div>
          )}
          {event.location && (
            <div className="flex items-center gap-1.5">
              <MapPin size={11} className="text-white/30" />
              <span>{event.location}</span>
            </div>
          )}
          {event.meetingLink && (
            <div className="flex items-center gap-1.5">
              <ExternalLink size={11} className="text-white/30" />
              <a
                href={event.meetingLink}
                onClick={(e) => e.stopPropagation()}
                target="_blank"
                rel="noopener noreferrer"
                className="text-brett-gold/70 hover:text-brett-gold transition-colors"
              >
                {isNow ? "Rejoin meeting" : "Join meeting link"}
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const attendeeColors = [
  { bg: "bg-blue-500/30", border: "border-blue-500/40", text: "text-blue-300" },
  { bg: "bg-purple-500/30", border: "border-purple-500/40", text: "text-purple-300" },
  { bg: "bg-emerald-500/30", border: "border-emerald-500/40", text: "text-emerald-300" },
  { bg: "bg-amber-500/30", border: "border-amber-500/40", text: "text-amber-300" },
  { bg: "bg-pink-500/30", border: "border-pink-500/40", text: "text-pink-300" },
];

function ExpandedCard({
  event,
  timer,
  onEventClick,
}: {
  event: CalendarEventDisplay;
  timer: NextUpTimerState;
  onEventClick: () => void;
}) {
  const shownTitle = useDisplayTitle(event.id, event.title, "calendar");
  return (
    <div
      onClick={onEventClick}
      className="w-full bg-black/40 backdrop-blur-md border border-amber-500/30 rounded-xl p-5 cursor-pointer hover:bg-black/40 transition-all duration-200 group relative overflow-hidden"
    >
      <div className="absolute top-0 right-0 w-32 h-32 bg-amber-500/[0.06] rounded-full blur-2xl -mr-12 -mt-12 pointer-events-none" />

      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-[0.15em] font-semibold text-amber-500/90">Up Next</span>
          <span className="px-2.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400 text-xs font-semibold animate-pulse">
            {timer.label}
          </span>
        </div>
        {event.meetingLink && (
          <a
            href={event.meetingLink}
            onClick={(e) => e.stopPropagation()}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-brett-gold/80 hover:text-brett-gold transition-colors flex items-center gap-1"
          >
            Join Meeting
            <ExternalLink size={12} />
          </a>
        )}
      </div>

      <h3 className="text-xl font-semibold text-white mb-3 group-hover:text-amber-50 transition-colors">
        {shownTitle}
      </h3>

      <div className="flex flex-wrap gap-4 text-xs text-white/50 mb-4">
        <span className="flex items-center gap-1.5">
          <Clock size={12} className="text-white/30" />
          {formatTimeRange(event.startTime, event.endTime)}
        </span>
        {event.location && (
          <span className="flex items-center gap-1.5">
            <MapPin size={12} className="text-white/30" />
            {event.location}
          </span>
        )}
        {event.attendees && event.attendees.length > 0 && (
          <span className="flex items-center gap-1.5">
            <Users size={12} className="text-white/30" />
            {event.attendees.map((a) => a.name).join(", ")} + you
          </span>
        )}
      </div>

      <div className="border-t border-white/10 mb-3" />

      {event.description && (
        <div className="mb-4">
          <div className="text-[10px] uppercase tracking-[0.15em] font-medium text-white/30 mb-1.5">From the invite</div>
          <p className="text-[13px] text-white/60 leading-relaxed">{event.description}</p>
        </div>
      )}

      {event.attendees && event.attendees.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-[0.15em] font-medium text-white/30 mb-2">Attendees</div>
          <div className="flex gap-2">
            {event.attendees.map((attendee, i) => {
              const color = attendeeColors[i % attendeeColors.length];
              return (
                <div
                  key={attendee.initials + i}
                  className={`w-7 h-7 rounded-full ${color.bg} border ${color.border} flex items-center justify-center text-[10px] ${color.text} font-semibold`}
                >
                  {attendee.initials}
                </div>
              );
            })}
            <div className="w-7 h-7 rounded-full bg-emerald-500/30 border border-emerald-500/40 flex items-center justify-center text-[10px] text-emerald-300 font-semibold">
              You
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Format time range, handling both "HH:MM" and ISO strings */
function formatTimeRange(start: string, end: string): string {
  if (start.includes("T") || start.includes("-")) {
    const s = new Date(start);
    const e = new Date(end);
    const fmt = (d: Date) => d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    return `${fmt(s)} – ${fmt(e)}`;
  }
  return `${start} – ${end}`;
}
