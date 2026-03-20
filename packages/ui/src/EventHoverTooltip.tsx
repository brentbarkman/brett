import React, { useState, useRef, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import { MapPin, Users, RefreshCw, Check, HelpCircle, X } from "lucide-react";
import type { CalendarEventDisplay, CalendarRsvpStatus } from "@brett/types";

interface EventHoverTooltipProps {
  event: CalendarEventDisplay;
  children: React.ReactNode;
  side?: "left" | "right" | "top" | "bottom";
}

function RsvpBadge({ status }: { status: CalendarRsvpStatus }) {
  switch (status) {
    case "accepted":
      return (
        <span className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-green-500/20 text-green-400">
          <Check size={10} /> Accepted
        </span>
      );
    case "tentative":
      return (
        <span className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-yellow-500/20 text-yellow-400">
          <HelpCircle size={10} /> Tentative
        </span>
      );
    case "declined":
      return (
        <span className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-red-500/20 text-red-400">
          <X size={10} /> Declined
        </span>
      );
    default:
      return (
        <span className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-white/10 text-white/40">
          No response
        </span>
      );
  }
}

function formatTooltipTime(start: string, end: string, isAllDay: boolean): string {
  if (isAllDay) return "All day";
  const startDate = new Date(start);
  const endDate = new Date(end);
  const startTime = startDate.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
  const endTime = endDate.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${startTime} – ${endTime}`;
}

export function EventHoverTooltip({
  event,
  children,
  side = "right",
}: EventHoverTooltipProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const triggerRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();
  const [position, setPosition] = useState({ top: 0, left: 0 });

  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const gap = 8;

    let top: number;
    let left: number;

    switch (side) {
      case "left":
        top = rect.top;
        left = rect.left - gap;
        break;
      case "top":
        top = rect.top - gap;
        left = rect.left + rect.width / 2;
        break;
      case "bottom":
        top = rect.bottom + gap;
        left = rect.left + rect.width / 2;
        break;
      case "right":
      default:
        top = rect.top;
        left = rect.right + gap;
        break;
    }

    setPosition({ top, left });
  }, [side]);

  const handleMouseEnter = useCallback(() => {
    updatePosition();
    setIsVisible(true);
    setIsExpanded(false);
    timerRef.current = setTimeout(() => {
      setIsExpanded(true);
    }, 1500);
  }, [updatePosition]);

  const handleMouseLeave = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setIsVisible(false);
    setIsExpanded(false);
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const attendeeCount = event.attendees?.length ?? 0;
  const visibleAttendees = event.attendees?.slice(0, 4);
  const hiddenAttendeeCount = attendeeCount - 4;

  const transformOrigin =
    side === "left"
      ? "right center"
      : side === "top"
        ? "bottom center"
        : side === "bottom"
          ? "top center"
          : "left center";

  const translateStyle =
    side === "left"
      ? { transform: "translateX(-100%)" }
      : side === "top"
        ? { transform: "translate(-50%, -100%)" }
        : side === "bottom"
          ? { transform: "translateX(-50%)" }
          : {};

  const tooltip = isVisible
    ? createPortal(
        <div
          className="fixed z-[100] pointer-events-none"
          style={{
            top: position.top,
            left: position.left,
            ...translateStyle,
          }}
        >
          <div
            className="bg-black/85 backdrop-blur-xl border border-white/[0.12] rounded-xl shadow-2xl overflow-hidden transition-all duration-300 ease-out"
            style={{
              transformOrigin,
              width: isExpanded ? 320 : 260,
              maxWidth: "90vw",
            }}
          >
            <div className="p-3">
              {/* Compact: always visible */}
              <h4 className="text-sm font-semibold text-white leading-tight mb-1">
                {event.title}
              </h4>
              <div className="flex items-center gap-2 text-xs text-white/60 mb-1">
                <span>
                  {formatTooltipTime(event.startTime, event.endTime, event.isAllDay)}
                </span>
                {event.location && (
                  <>
                    <span className="text-white/20">·</span>
                    <span className="flex items-center gap-1 truncate">
                      <MapPin size={10} className="flex-shrink-0" />
                      <span className="truncate">{event.location}</span>
                    </span>
                  </>
                )}
              </div>
              {event.description && (
                <p className="text-xs text-white/50 leading-relaxed line-clamp-2 mb-1">
                  {event.description}
                </p>
              )}
              {attendeeCount > 0 && !isExpanded && (
                <span className="text-xs text-white/40 flex items-center gap-1">
                  <Users size={10} />
                  {attendeeCount} attendee{attendeeCount !== 1 ? "s" : ""}
                </span>
              )}

              {/* Expanded: additional details */}
              {isExpanded && (
                <div className="mt-2 pt-2 border-t border-white/[0.06] space-y-2">
                  {/* RSVP badge */}
                  <RsvpBadge status={event.myResponseStatus} />

                  {/* Full description */}
                  {event.description && (
                    <p className="text-xs text-white/50 leading-relaxed whitespace-pre-wrap">
                      {event.description}
                    </p>
                  )}

                  {/* Attendees */}
                  {visibleAttendees && visibleAttendees.length > 0 && (
                    <div>
                      <span className="text-[10px] text-white/30 uppercase tracking-wider font-semibold block mb-1">
                        Attendees
                      </span>
                      <div className="flex flex-col gap-1">
                        {visibleAttendees.map((att, idx) => (
                          <div
                            key={idx}
                            className="flex items-center gap-2 text-xs text-white/60"
                          >
                            <div className="w-5 h-5 rounded-full bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center text-[8px] font-bold text-white flex-shrink-0">
                              {att.initials}
                            </div>
                            <span className="truncate">{att.name}</span>
                          </div>
                        ))}
                        {hiddenAttendeeCount > 0 && (
                          <span className="text-[10px] text-white/30 ml-7">
                            +{hiddenAttendeeCount} more
                          </span>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Recurrence */}
                  {event.recurrence && (
                    <span className="flex items-center gap-1 text-xs text-white/40">
                      <RefreshCw size={10} />
                      {event.recurrence}
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>,
        document.body,
      )
    : null;

  return (
    <div
      ref={triggerRef}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {children}
      {tooltip}
    </div>
  );
}
