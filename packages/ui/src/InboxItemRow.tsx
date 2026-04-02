import React, { useState, useEffect, useRef } from "react";
import { Zap, BookOpen, Check, MessageSquare, FileText, Play, File, Headphones, Globe } from "lucide-react";
import type { Thing } from "@brett/types";
import { useDraggable } from "@dnd-kit/core";

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
}: InboxItemRowProps) {
  const [completing, setCompleting] = useState(false);
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

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (completing || !onToggle) return;
    setCompleting(true);
    timerRef.current = setTimeout(() => {
      onToggle(thing.id);
      // Don't reset completing — item stays in completed visual until removed
    }, 600);
  };

  return (
    <div
      ref={setNodeRef}
      onClick={onClick}
      onFocus={onFocus}
      {...listeners}
      {...attributes}
      tabIndex={0}
      role={undefined}
      className={`
        group flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer
        transition-colors duration-200 outline-none
        ${isDragging ? "opacity-30" : ""}
        ${isFocused
          ? "bg-white/10 border border-white/5"
          : isSelected
            ? "bg-white/10 border border-white/5"
            : "border border-transparent hover:bg-white/10 hover:-translate-y-[1px] hover:shadow-lg"
        }
      `}
      style={animationStyle}
    >
      {/* Toggle button */}
      <button
        tabIndex={-1}
        onClick={handleToggle}
        onPointerDown={(e) => e.stopPropagation()}
        className={`
          toggle-btn flex-shrink-0 w-8 h-8 rounded-full border flex items-center justify-center
          transition-all duration-150 relative outline-none
          ${completing
            ? "bg-brett-teal/20 border-brett-teal/40"
            : `border-white/20 hover:border-brett-teal/40 hover:bg-brett-teal/10`
          }
        `}
      >
        {completing ? (
          <Check size={13} className="text-brett-teal check-pop" />
        ) : (
          <>
            <span className="toggle-icon"><Icon size={12} className={iconColor} /></span>
            <span className="toggle-check"><Check size={13} className="text-brett-teal" /></span>
          </>
        )}
      </button>

      {/* Title + provenance */}
      <div className="flex-1 min-w-0">
        <span className="text-sm text-white/90 truncate block">
          {thing.title}
        </span>
        {((thing.source === "scout" && thing.scoutName) ||
          (thing.source === "Granola" && thing.meetingNoteTitle)) && (
          <span className="text-[10px] text-white/50 truncate block mt-0.5">
            from {thing.source === "scout" ? thing.scoutName : thing.meetingNoteTitle}
          </span>
        )}
      </div>

      {/* Source pill */}
      {!hideSource && thing.source && thing.source !== "Brett" && (
        <span className="flex-shrink-0 text-[11px] text-white/40 px-1.5 py-0.5 rounded bg-white/5">
          {thing.source}
        </span>
      )}

      {/* Relative age */}
      <span className="flex-shrink-0 text-xs text-white/40 tabular-nums">
        {relativeAge}
      </span>

    </div>
  );
}
