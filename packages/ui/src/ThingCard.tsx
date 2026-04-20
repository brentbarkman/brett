import React, { useState, useEffect, useRef } from "react";
import { StaleTooltip } from "./StaleTooltip";
import { Zap, BookOpen, Calendar, Check, RotateCcw, MessageSquare, FileText, Play, File, Headphones, Globe, RefreshCw, Download } from "lucide-react";
import { useDraggable } from "@dnd-kit/core";
import type { Thing } from "@brett/types";
import { useDisplayTitle } from "./lib/demoMode";

interface ThingCardProps {
  thing: Thing;
  onClick: () => void;
  onToggle?: (id: string) => void;
  onFocus?: () => void;
  isFocused?: boolean;
  onReconnect?: () => void;
  reconnectPending?: boolean;
  onInstallUpdate?: () => void;
}

export function ThingCard({ thing, onClick, onToggle, onFocus, isFocused, onReconnect, reconnectPending, onInstallUpdate }: ThingCardProps) {
  const shownTitle = useDisplayTitle(thing.id, thing.title, "thing");
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: thing.id,
    data: {
      type: "thing-card",
      thingId: thing.id,
    },
  });
  const [completing, setCompleting] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const handleToggleClick = 
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!onToggle || completing) return;

      if (!thing.isCompleted) {
        setCompleting(true);
        // Check pop plays for 500ms, then notify parent
        // Stay in completing state — parent defers mutation during rapid-fire
        timerRef.current = setTimeout(() => {
          onToggle(thing.id);
        }, 500);
      } else {
        onToggle(thing.id);
      }
    };

  const getIcon = () => {
    if (thing.type === "content") {
      switch (thing.contentType) {
        case "tweet":
          return <MessageSquare size={16} className="text-amber-400" />;
        case "article":
          return <FileText size={16} className="text-amber-400" />;
        case "video":
          return <Play size={16} className="text-amber-400" />;
        case "pdf":
          return <File size={16} className="text-amber-400" />;
        case "podcast":
          return <Headphones size={16} className="text-amber-400" />;
        case "web_page":
        default:
          return <Globe size={16} className="text-amber-400" />;
      }
    }
    return <Zap size={16} className="text-brett-gold" />;
  };

  const getUrgencyColor = () => {
    switch (thing.urgency) {
      case "overdue":
        return "bg-brett-red/20 text-brett-red border border-brett-red/20 font-semibold";
      case "today":
        return "bg-amber-500/20 text-amber-400 border border-amber-500/20";
      default:
        return "bg-white/5 text-white/50 border border-white/5";
    }
  };

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={() => { onFocus?.(); onClick(); }}
      onFocus={onFocus}
      className={`
        group relative flex items-center gap-3 p-3 rounded-lg cursor-pointer
        border transition-all duration-200 outline-none
        ${completing
          ? "bg-brett-teal/[0.03] border-brett-teal/15"
          : isFocused
            ? "bg-white/10 border-brett-gold/30"
            : "bg-white/5 hover:bg-white/10 hover:-translate-y-[1px] hover:shadow-lg border-white/5 hover:border-white/10"
        }
        ${thing.isCompleted && !completing ? "opacity-60" : "opacity-100"}
        ${isDragging ? "opacity-50" : ""}
      `}
    >
      {/* Clickable toggle icon */}
      <button
        tabIndex={-1}
        onClick={handleToggleClick}
        className={`
          toggle-icon relative flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center
          transition-all duration-200 outline-none
          ${completing
            ? "bg-brett-teal/20 border-2 border-brett-teal/50"
            : thing.isCompleted
              ? "bg-black/20 border border-white/10 hover:border-white/30 hover:bg-white/10"
              : "bg-black/20 border border-white/10 hover:border-brett-teal/40 hover:bg-brett-teal/10"
          }
        `}
        style={completing ? {
          animation: "togglePulse 600ms cubic-bezier(0.16, 1, 0.3, 1)",
        } : undefined}
      >
        {/* Default type icon — hidden via CSS when .toggle-icon:hover */}
        <span className="transition-all duration-150">
          {!completing && getIcon()}
        </span>

        {/* Check overlay on hover (uncompleted) / undo overlay (completed) */}
        {!completing && !thing.isCompleted && (
          <Check
            size={16}
            className="check-overlay absolute text-brett-teal transition-all duration-150"
          />
        )}
        {!completing && thing.isCompleted && (
          <RotateCcw
            size={14}
            className="check-overlay absolute text-white/50 transition-all duration-150"
          />
        )}

        {/* Check icon when completing */}
        {completing && (
          <Check
            size={18}
            strokeWidth={2.5}
            className="absolute text-brett-teal"
            style={{ animation: "checkPop 400ms cubic-bezier(0.16, 1, 0.3, 1) forwards" }}
          />
        )}
      </button>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <h4
            className={`text-sm font-medium truncate transition-all duration-300 ${
              thing.isCompleted || completing
                ? "line-through text-white/40"
                : "text-white"
            }`}
          >
            {shownTitle}
          </h4>
          {thing.stalenessDays && !thing.isCompleted && !completing && (
            <StaleTooltip days={thing.stalenessDays}>
              <div className="w-1.5 h-1.5 rounded-full bg-amber-500/60 flex-shrink-0" />
            </StaleTooltip>
          )}
        </div>
        {/* Provenance subtitle — shown below title when from a scout or meeting */}
        {!thing.isCompleted && !completing && (
          (thing.source === "Granola" && thing.meetingNoteTitle) ||
          (thing.source === "scout" && thing.scoutName)
        ) && (
          <span className="text-[10px] text-white/50 truncate block mt-0.5">
            from {thing.source === "scout" ? thing.scoutName : thing.meetingNoteTitle}
          </span>
        )}
      </div>

      <div className="flex-shrink-0 flex items-center gap-2">
        {/* Install update button for system update tasks */}
        {onInstallUpdate && thing.sourceId === "system:update" && (
          <button
            onClick={(e) => { e.stopPropagation(); onInstallUpdate(); }}
            onPointerDown={(e) => e.stopPropagation()}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium bg-brett-gold/15 text-brett-gold hover:bg-brett-gold/25 transition-colors"
          >
            <Download size={11} />
            Install &amp; Restart
          </button>
        )}
        {/* Reconnect button for broken integrations */}
        {onReconnect && thing.sourceId?.startsWith("relink:") && (
          <button
            onClick={(e) => { e.stopPropagation(); onReconnect(); }}
            onPointerDown={(e) => e.stopPropagation()}
            disabled={reconnectPending}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium bg-brett-gold/15 text-brett-gold hover:bg-brett-gold/25 transition-colors disabled:opacity-50"
          >
            <RefreshCw size={11} className={reconnectPending ? "animate-spin" : ""} />
            {reconnectPending ? "Connecting..." : "Reconnect"}
          </button>
        )}
        {thing.list && thing.list !== "Inbox" && (
          <span className="text-xs text-white/50 truncate max-w-[100px]">{thing.list}</span>
        )}
        {thing.dueDateLabel ? (
          <div
            className={`px-2.5 py-1 rounded-full text-xs font-medium ${
              thing.isCompleted
                ? "bg-white/5 text-white/30 border border-white/5"
                : getUrgencyColor()
            }`}
          >
            {thing.dueDateLabel}
          </div>
        ) : (
          <div className="w-8 h-8 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
            <Calendar size={14} className="text-white/30" />
          </div>
        )}
      </div>

    </div>
  );
}
