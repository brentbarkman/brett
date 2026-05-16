import React, { useState, useEffect, useRef } from "react";
import { Zap, Check, MessageSquare, FileText, Play, File, Headphones, Globe, RefreshCw, Download } from "lucide-react";
import type { Thing } from "@brett/types";
import { useDraggable } from "@dnd-kit/core";
import { useDisplayTitle } from "./lib/demoMode";

interface InboxItemRowProps {
  thing: Thing;
  isFocused: boolean;
  isSelected: boolean;
  isAnimatingOut: boolean;
  isNew?: boolean;
  relativeAge: string;
  selectedIds: Set<string>;
  /** When true, suppress the source pill (all items share the same source) */
  hideSource?: boolean;
  onClick: () => void;
  onFocus?: () => void;
  onToggle?: (id: string) => void;
  onSelect: () => void;
  onReconnect?: () => void;
  reconnectPending?: boolean;
  onInstallUpdate?: () => void;
  /** Forwards the row's DOM element so the parent can anchor a popover to it. */
  onElementRef?: (el: HTMLDivElement | null) => void;
}

export function InboxItemRow({
  thing,
  isFocused,
  isSelected,
  isAnimatingOut,
  isNew,
  relativeAge,
  selectedIds,
  hideSource,
  onClick,
  onFocus,
  onToggle,
  onSelect,
  onReconnect,
  reconnectPending,
  onInstallUpdate,
  onElementRef,
}: InboxItemRowProps) {
  const [completing, setCompleting] = useState(false);
  const shownTitle = useDisplayTitle(thing.id, thing.title, "thing");
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: thing.id,
    data: {
      type: "inbox-item",
      thingId: thing.id,
      selectedIds: selectedIds.size > 0 ? [...selectedIds] : [thing.id],
    },
  });

  const isTask = thing.type === "task";
  const iconColor = isTask ? "text-brett-gold" : "text-amber-400";
  const Icon = isTask ? Zap : (() => {
    switch (thing.contentType) {
      case "tweet": return MessageSquare;
      case "article": return FileText;
      case "video": return Play;
      case "pdf": return File;
      case "podcast": return Headphones;
      default: return Globe;
    }
  })();

  const animationStyle: React.CSSProperties | undefined = isAnimatingOut
    ? {
        animation:
          "inboxSlideOut 220ms cubic-bezier(0.2, 0, 0.6, 1) forwards",
      }
    : undefined;

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rowRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  useEffect(() => {
    if (isFocused) rowRef.current?.scrollIntoView({ block: "nearest" });
  }, [isFocused]);

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (completing || !onToggle) return;
    setCompleting(true);
    timerRef.current = setTimeout(() => {
      onToggle(thing.id);
      // Don't reset completing — item stays in completed visual until removed
    }, 600);
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
        rowRef.current = node;
        onElementRef?.(node);
      }}
      onClick={onClick}
      onFocus={onFocus}
      {...listeners}
      {...attributes}
      tabIndex={0}
      role={undefined}
      className={`
        group/row flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer
        border-t border-white/[0.05]
        transition-colors duration-150 outline-none
        ${isDragging ? "opacity-30" : ""}
        ${isFocused
          ? "bg-brett-gold/[0.08]"
          : isSelected
            ? "bg-white/[0.06]"
            : "hover:bg-white/[0.04]"
        }
      `}
      style={animationStyle}
    >
      {/* Toggle — bare type icon by default; row-hover swaps it for a
          hollow ring. Same pattern as ThingCard so Today/Inbox/Lists read
          identically (CLAUDE.md list-consistency rule). */}
      <button
        tabIndex={-1}
        onClick={handleToggle}
        onPointerDown={(e) => e.stopPropagation()}
        className="group/btn relative flex-shrink-0 w-4 h-4 flex items-center justify-center outline-none"
        aria-label="Complete"
      >
        {completing ? (
          <Check
            size={14}
            strokeWidth={2.5}
            className="text-brett-teal"
            style={{ animation: "checkPop 400ms cubic-bezier(0.16, 1, 0.3, 1) forwards" }}
          />
        ) : (
          <>
            <span className="group-hover/row:hidden flex items-center justify-center">
              <Icon size={13} className={iconColor} />
            </span>
            <span className="hidden group-hover/row:flex items-center justify-center w-3.5 h-3.5 rounded-full border border-white/40 transition-colors duration-100 group-hover/btn:border-brett-teal group-hover/btn:bg-brett-teal/20" />
          </>
        )}
      </button>

      {/* Title + inline provenance */}
      <div className="flex-1 min-w-0 flex items-center gap-1.5">
        <span className="text-[13.5px] font-normal text-white/90 truncate">
          {shownTitle}
        </span>
        {provenance && (
          <span className="text-[11px] text-white/40 truncate flex-shrink min-w-0 hidden sm:inline">
            · from {provenance}
          </span>
        )}
      </div>

      {/* Source pill — small enough to coexist with the naked row */}
      {!hideSource && thing.source && thing.source !== "Brett" && (
        <span className="flex-shrink-0 text-[10.5px] text-white/40 px-1.5 py-0.5 rounded bg-white/5">
          {thing.source}
        </span>
      )}

      {/* Install update — CTA pill chrome stays */}
      {onInstallUpdate && thing.sourceId === "system:update" && (
        <button
          onClick={(e) => { e.stopPropagation(); onInstallUpdate(); }}
          onPointerDown={(e) => e.stopPropagation()}
          className="flex-shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium bg-brett-gold/15 text-brett-gold hover:bg-brett-gold/25 transition-colors"
        >
          <Download size={11} />
          Install &amp; Restart
        </button>
      )}

      {/* Reconnect — CTA pill chrome stays */}
      {onReconnect && thing.sourceId?.startsWith("relink:") && (
        <button
          onClick={(e) => { e.stopPropagation(); onReconnect(); }}
          onPointerDown={(e) => e.stopPropagation()}
          disabled={reconnectPending}
          className="flex-shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium bg-brett-gold/15 text-brett-gold hover:bg-brett-gold/25 transition-colors disabled:opacity-50"
        >
          <RefreshCw size={11} className={reconnectPending ? "animate-spin" : ""} />
          {reconnectPending ? "Connecting..." : "Reconnect"}
        </button>
      )}

      {/* Relative age */}
      <span className="flex-shrink-0 text-[11px] text-white/40 tabular-nums">
        {relativeAge}
      </span>

    </div>
  );
}
