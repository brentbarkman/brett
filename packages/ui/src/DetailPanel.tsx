import React from "react";
import { X, Calendar, MapPin, Users, CheckCircle } from "lucide-react";
import type { Thing, CalendarEvent } from "@brett/types";

interface DetailPanelProps {
  isOpen: boolean;
  item: Thing | CalendarEvent | null;
  onClose: () => void;
  onToggle?: (id: string) => void;
}

export function DetailPanel({ isOpen, item, onClose, onToggle }: DetailPanelProps) {
  if (!item) return null;
  const isTask = !("startTime" in item);

  return (
    <div
      className={`
        fixed top-0 right-0 bottom-0 w-[400px] bg-black/60 backdrop-blur-2xl border-l border-white/10
        shadow-2xl z-50 transform transition-transform duration-300 ease-out flex flex-col
        ${isOpen ? "translate-x-0" : "translate-x-full"}
      `}
    >
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-white/10">
        <span className="font-mono text-xs uppercase tracking-wider text-white/40">
          {isTask ? "Detail" : "Event"}
        </span>
        <button
          onClick={onClose}
          className="p-1.5 text-white/50 hover:text-white hover:bg-white/10 rounded-full transition-colors"
        >
          <X size={16} />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6 scrollbar-hide">
        <h2 className="text-2xl font-semibold text-white mb-6 leading-tight">
          {item.title}
        </h2>

        {/* Brett's Take */}
        {item.brettObservation && (
          <div className="mb-8 bg-blue-500/10 border-l-2 border-blue-500 p-4 rounded-r-lg">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-1.5 h-1.5 rounded-full bg-blue-500" />
              <span className="text-xs font-mono uppercase text-blue-400 font-semibold">
                Brett's Take
              </span>
            </div>
            <p className="text-sm italic text-blue-300/90 leading-relaxed">
              "{item.brettObservation}"
            </p>
          </div>
        )}

        {/* Task Specific Details */}
        {isTask && (
          <div className="space-y-6">
            <div className="flex flex-wrap gap-2">
              <div className="px-2.5 py-1 rounded-md bg-white/5 border border-white/10 text-xs text-white/70">
                List: {(item as Thing).list}
              </div>
              <div className="px-2.5 py-1 rounded-md bg-white/5 border border-white/10 text-xs text-white/70">
                Source: {(item as Thing).source}
              </div>
              {(item as Thing).dueDateLabel && (
                <div className="px-2.5 py-1 rounded-md bg-white/5 border border-white/10 text-xs text-white/70 flex items-center gap-1.5">
                  <Calendar size={12} />
                  {(item as Thing).dueDateLabel}
                </div>
              )}
            </div>

            {(item as Thing).description && (
              <div className="text-sm text-white/80 leading-relaxed">
                {(item as Thing).description}
              </div>
            )}

            <button
              onClick={() => onToggle?.(item.id)}
              className="w-full mt-4 flex items-center justify-center gap-2 bg-white/10 hover:bg-white/20 text-white py-2.5 rounded-lg transition-colors font-medium text-sm border border-white/10"
            >
              <CheckCircle size={16} />
              {(item as Thing).isCompleted ? "Mark Incomplete" : "Mark Complete"}
            </button>
          </div>
        )}

        {/* Event Specific Details */}
        {!isTask && (
          <div className="space-y-6">
            <div className="space-y-3">
              <div className="flex items-center gap-3 text-sm text-white/80">
                <Calendar size={16} className="text-white/40" />
                <span>
                  Today, {(item as CalendarEvent).startTime} -{" "}
                  {(item as CalendarEvent).endTime}
                </span>
              </div>
              {(item as CalendarEvent).location && (
                <div className="flex items-center gap-3 text-sm text-white/80">
                  <MapPin size={16} className="text-white/40" />
                  <span>{(item as CalendarEvent).location}</span>
                </div>
              )}
            </div>

            {(item as CalendarEvent).attendees && (
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <Users size={14} className="text-white/40" />
                  <span className="text-xs font-medium text-white/50 uppercase tracking-wider">
                    Attendees
                  </span>
                </div>
                <div className="flex flex-col gap-2">
                  {(item as CalendarEvent).attendees!.map((attendee, idx) => (
                    <div
                      key={idx}
                      className="flex items-center gap-3 bg-white/5 p-2 rounded-lg border border-white/5"
                    >
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center text-xs font-bold text-white shadow-inner">
                        {attendee.initials}
                      </div>
                      <span className="text-sm text-white/90">
                        {attendee.name}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
