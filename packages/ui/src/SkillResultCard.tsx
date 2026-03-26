import React from "react";
import { Check, Calendar, Settings, List, ArrowRight } from "lucide-react";
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
    // ─── Action confirmations (create, complete, move, etc.) ───
    // Subtle inline confirmation — small check icon, text with links.
    // Follows "whisper, don't shout" — no colored backgrounds.
    case "task_created":
    case "confirmation":
      return (
        <div className="flex items-start gap-2 py-1">
          <Check size={14} className="text-green-400/70 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-white/60 min-w-0">
            <SimpleMarkdown
              content={displayHint.type === "confirmation" ? (displayHint.message ?? message ?? "Done.") : (message ?? "Done.")}
              onItemClick={onItemClick}
              onNavigate={onNavigate}
            />
          </div>
        </div>
      );

    // ─── Task/item lists ───
    // Glass card with items — follows card pattern from design guide.
    case "task_list": {
      const items = displayHint.items ?? [];
      return (
        <div className="rounded-lg bg-white/[0.03] border border-white/[0.06] overflow-hidden">
          {items.slice(0, 8).map((item, i) => (
            <button
              key={item.id}
              className={`w-full px-3 py-1.5 flex items-center gap-2.5 hover:bg-white/5 transition-colors text-left ${
                i > 0 ? "border-t border-white/[0.03]" : ""
              }`}
              onClick={() => onItemClick?.(item.id)}
            >
              <div
                className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                  item.status === "done" ? "bg-green-400/60" : "bg-blue-400/40"
                }`}
              />
              <span className={`text-sm truncate ${onItemClick ? "text-white/70 hover:text-white/90" : "text-white/70"}`}>
                {item.title}
              </span>
              {onItemClick && (
                <ArrowRight size={10} className="ml-auto text-white/20 flex-shrink-0" />
              )}
            </button>
          ))}
          {items.length > 8 && (
            <div className="px-3 py-1.5 text-[10px] text-white/30 border-t border-white/[0.03]">
              +{items.length - 8} more
            </div>
          )}
        </div>
      );
    }

    // ─── Calendar events ───
    case "calendar_events": {
      const events = displayHint.events ?? [];
      return (
        <div className="rounded-lg bg-white/[0.03] border border-white/[0.06] overflow-hidden">
          {events.slice(0, 6).map((event, i) => {
            const start = new Date(event.startTime);
            const time = start.toLocaleTimeString("en-US", {
              hour: "numeric",
              minute: "2-digit",
            });
            return (
              <div
                key={event.id}
                className={`px-3 py-1.5 flex items-center gap-2.5 ${
                  i > 0 ? "border-t border-white/[0.03]" : ""
                }`}
              >
                <span className="text-[11px] font-mono text-blue-400/60 w-14 flex-shrink-0">
                  {time}
                </span>
                <span className="text-sm text-white/70 truncate">
                  {event.title}
                </span>
              </div>
            );
          })}
        </div>
      );
    }

    // ─── Settings change ───
    case "settings_changed":
      return (
        <div className="flex items-start gap-2 py-1">
          <Settings size={14} className="text-white/30 flex-shrink-0 mt-0.5" />
          <span className="text-sm text-white/60">
            Updated: {displayHint.setting}
          </span>
        </div>
      );

    // ─── Generic text/list/detail results ───
    case "text":
    case "list":
    case "detail":
      if (message) {
        return (
          <div className="text-sm text-white/60">
            <SimpleMarkdown content={message} onItemClick={onItemClick} onNavigate={onNavigate} />
          </div>
        );
      }
      return null;

    default:
      return null;
  }
}
