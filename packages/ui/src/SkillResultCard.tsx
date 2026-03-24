import React from "react";
import { Check, Calendar, Settings, MessageSquare, List } from "lucide-react";
import type { DisplayHint } from "@brett/types";

interface SkillResultCardProps {
  displayHint: DisplayHint;
  data?: unknown;
  message?: string;
}

export function SkillResultCard({ displayHint, data, message }: SkillResultCardProps) {
  switch (displayHint.type) {
    case "task_created":
      return (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-green-500/10 border border-green-500/20">
          <div className="w-5 h-5 rounded-full bg-green-500/20 flex items-center justify-center flex-shrink-0">
            <Check size={12} className="text-green-400" />
          </div>
          <span className="text-sm text-white/80">
            Created: {message ?? "New task"}
          </span>
        </div>
      );

    case "task_list": {
      const items = displayHint.items ?? [];
      return (
        <div className="rounded-lg bg-white/5 border border-white/10 overflow-hidden">
          <div className="px-3 py-1.5 border-b border-white/5 flex items-center gap-2">
            <List size={12} className="text-white/40" />
            <span className="text-xs font-mono uppercase tracking-wider text-white/40">
              Tasks
            </span>
          </div>
          <div className="divide-y divide-white/5">
            {items.slice(0, 8).map((item) => (
              <div key={item.id} className="px-3 py-1.5 flex items-center gap-2">
                <div
                  className={`w-2 h-2 rounded-full flex-shrink-0 ${
                    item.status === "completed"
                      ? "bg-green-400"
                      : "bg-white/20"
                  }`}
                />
                <span className="text-sm text-white/80 truncate">
                  {item.title}
                </span>
              </div>
            ))}
            {items.length > 8 && (
              <div className="px-3 py-1.5 text-xs text-white/40">
                +{items.length - 8} more
              </div>
            )}
          </div>
        </div>
      );
    }

    case "calendar_events": {
      const events = displayHint.events ?? [];
      return (
        <div className="rounded-lg bg-white/5 border border-white/10 overflow-hidden">
          <div className="px-3 py-1.5 border-b border-white/5 flex items-center gap-2">
            <Calendar size={12} className="text-blue-400" />
            <span className="text-xs font-mono uppercase tracking-wider text-white/40">
              Events
            </span>
          </div>
          <div className="divide-y divide-white/5">
            {events.slice(0, 6).map((event) => {
              const start = new Date(event.startTime);
              const time = start.toLocaleTimeString("en-US", {
                hour: "numeric",
                minute: "2-digit",
              });
              return (
                <div key={event.id} className="px-3 py-1.5 flex items-center gap-2">
                  <span className="text-xs text-white/40 w-16 flex-shrink-0">
                    {time}
                  </span>
                  <span className="text-sm text-white/80 truncate">
                    {event.title}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      );
    }

    case "confirmation":
      return (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-green-500/10 border border-green-500/20">
          <Check size={14} className="text-green-400 flex-shrink-0" />
          <span className="text-sm text-white/80">
            {displayHint.message ?? message ?? "Done"}
          </span>
        </div>
      );

    case "settings_changed":
      return (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20">
          <Settings size={14} className="text-amber-400 flex-shrink-0" />
          <span className="text-sm text-white/80">
            Updated: {displayHint.setting}
          </span>
        </div>
      );

    case "text":
    case "list":
    case "detail":
      if (message) {
        return (
          <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-white/5 border border-white/10">
            <MessageSquare size={14} className="text-white/40 flex-shrink-0 mt-0.5" />
            <span className="text-sm text-white/80">{message}</span>
          </div>
        );
      }
      return null;

    default:
      return null;
  }
}
