import React from "react";
import { Check, Calendar, Settings, MessageSquare, List } from "lucide-react";
import { SimpleMarkdown } from "./SimpleMarkdown";
import type { DisplayHint } from "@brett/types";

interface SkillResultCardProps {
  displayHint: DisplayHint;
  data?: unknown;
  message?: string;
  onItemClick?: (id: string) => void;
  onNavigate?: (path: string) => void;
}

export function SkillResultCard({ displayHint, data, message, onItemClick, onNavigate }: SkillResultCardProps) {
  switch (displayHint.type) {
    case "task_created":
      return (
        <div className="flex items-start gap-2.5 px-3 py-2.5 rounded-lg bg-green-500/10 border border-green-500/20">
          <div className="w-5 h-5 rounded-full bg-green-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
            <Check size={12} className="text-green-400" />
          </div>
          <div className="text-sm text-white/80 min-w-0">
            <SimpleMarkdown content={message ?? "Task created."} onItemClick={onItemClick} onNavigate={onNavigate} />
          </div>
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
              <button
                key={item.id}
                className="w-full px-3 py-1.5 flex items-center gap-2 hover:bg-white/5 transition-colors text-left"
                onClick={() => onItemClick?.(item.id)}
              >
                <div
                  className={`w-2 h-2 rounded-full flex-shrink-0 ${
                    item.status === "completed"
                      ? "bg-green-400"
                      : "bg-white/20"
                  }`}
                />
                <span className={`text-sm truncate ${onItemClick ? "text-blue-400 hover:text-blue-300" : "text-white/80"}`}>
                  {item.title}
                </span>
              </button>
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
        <div className="flex items-start gap-2.5 px-3 py-2.5 rounded-lg bg-green-500/10 border border-green-500/20">
          <div className="w-5 h-5 rounded-full bg-green-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
            <Check size={12} className="text-green-400" />
          </div>
          <div className="text-sm text-white/80 min-w-0">
            <SimpleMarkdown content={displayHint.message ?? message ?? "Done."} onItemClick={onItemClick} onNavigate={onNavigate} />
          </div>
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
