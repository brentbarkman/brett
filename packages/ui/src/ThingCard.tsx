import React, { useState, useEffect, useRef } from "react";
import { StaleTooltip } from "./StaleTooltip";
import { Zap, Calendar, Check, RotateCcw, MessageSquare, FileText, Play, File, Headphones, Globe, RefreshCw, Download } from "lucide-react";
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
  /** Forwards the card's DOM element so the parent can anchor a popover to it. */
  onElementRef?: (el: HTMLDivElement | null) => void;
}

export function ThingCard({ thing, onClick, onToggle, onFocus, isFocused, onReconnect, reconnectPending, onInstallUpdate, onElementRef }: ThingCardProps) {
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
  const cardRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  useEffect(() => {
    if (isFocused) cardRef.current?.scrollIntoView({ block: "nearest" });
  }, [isFocused]);

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
          return <MessageSquare size={13} className="text-amber-400" />;
        case "article":
          return <FileText size={13} className="text-amber-400" />;
        case "video":
          return <Play size={13} className="text-amber-400" />;
        case "pdf":
          return <File size={13} className="text-amber-400" />;
        case "podcast":
          return <Headphones size={13} className="text-amber-400" />;
        case "web_page":
        default:
          return <Globe size={13} className="text-amber-400" />;
      }
    }
    return <Zap size={13} className="text-brett-gold" />;
  };

  const getDueTextColor = () => {
    switch (thing.urgency) {
      case "overdue":
        return "text-brett-red";
      case "today":
        return "text-brett-gold";
      default:
        return "text-white/45";
    }
  };

  const provenance =
    thing.source === "scout" && thing.scoutName
      ? thing.scoutName
      : thing.source === "Granola" && thing.meetingNoteTitle
        ? thing.meetingNoteTitle
        : null;

  return (
    <div
      ref={(node) => {
        setNodeRef(node);
        cardRef.current = node;
        onElementRef?.(node);
      }}
      {...attributes}
      {...listeners}
      onClick={() => { onFocus?.(); onClick(); }}
      onFocus={onFocus}
      className={`
        group/row relative flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer
        transition-colors duration-150 outline-none
        ${completing
          ? "bg-brett-teal/[0.05]"
          : isFocused
            ? "bg-brett-gold/[0.08]"
            : "hover:bg-white/[0.04]"
        }
        ${isDragging ? "opacity-50" : ""}
      `}
    >
      {/* Toggle — bare type icon by default; on row hover, the icon hides
          and a hollow ring takes its place. Clicking either completes. */}
      <button
        tabIndex={-1}
        onClick={handleToggleClick}
        onPointerDown={(e) => e.stopPropagation()}
        className="group/btn relative flex-shrink-0 w-4 h-4 flex items-center justify-center outline-none"
        aria-label={thing.isCompleted ? "Mark as not done" : "Complete"}
      >
        {completing ? (
          <Check
            size={14}
            strokeWidth={2.5}
            className="text-brett-teal"
            style={{ animation: "checkPop 400ms cubic-bezier(0.16, 1, 0.3, 1) forwards" }}
          />
        ) : thing.isCompleted ? (
          <>
            {/* Completed: dim icon stays; row-hover swaps to undo glyph. */}
            <span className="group-hover/row:hidden flex items-center justify-center text-white/30">
              {getIcon()}
            </span>
            <RotateCcw
              size={13}
              className="hidden group-hover/row:block text-white/55 group-hover/btn:text-white"
            />
          </>
        ) : (
          <>
            {/* Idle: bare type icon. Row-hover: hollow ring. Button-hover: ring fills teal. */}
            <span className="group-hover/row:hidden flex items-center justify-center">
              {getIcon()}
            </span>
            <span className="hidden group-hover/row:flex items-center justify-center w-3.5 h-3.5 rounded-full border border-white/40 transition-colors duration-100 group-hover/btn:border-brett-teal group-hover/btn:bg-brett-teal/20" />
          </>
        )}
      </button>

      {/* Title + inline provenance + stale dot */}
      <div className="flex-1 min-w-0 flex items-center gap-1.5">
        <h4
          className={`text-[13.5px] font-normal truncate transition-colors duration-300 ${
            thing.isCompleted || completing
              ? "line-through text-white/40"
              : "text-white"
          }`}
        >
          {shownTitle}
        </h4>
        {provenance && !thing.isCompleted && !completing && (
          <span className="text-[11px] text-white/40 truncate flex-shrink min-w-0 hidden sm:inline">
            · from {provenance}
          </span>
        )}
        {thing.stalenessDays && !thing.isCompleted && !completing && (
          <StaleTooltip days={thing.stalenessDays}>
            <div className="w-1.5 h-1.5 rounded-full bg-amber-500/60 flex-shrink-0" />
          </StaleTooltip>
        )}
      </div>

      {/* Trailing meta — no pill chrome; color encodes urgency on the date */}
      <div className="flex-shrink-0 flex items-center gap-2.5">
        {/* Install update — keeps CTA pill chrome */}
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
        {/* Reconnect — keeps CTA pill chrome */}
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
          <span className="text-[11px] text-white/40 truncate max-w-[100px]">{thing.list}</span>
        )}
        {thing.dueDateLabel && (
          <span
            className={`text-xs font-medium tabular-nums ${
              thing.isCompleted ? "text-white/30" : getDueTextColor()
            }`}
          >
            {thing.dueDateLabel}
          </span>
        )}
      </div>

    </div>
  );
}
