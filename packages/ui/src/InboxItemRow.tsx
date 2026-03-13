import React from "react";
import { Zap, BookOpen } from "lucide-react";
import type { Thing } from "@brett/types";
import { useDraggable } from "@dnd-kit/core";

interface InboxItemRowProps {
  thing: Thing;
  isFocused: boolean;
  isSelected: boolean;
  isAnimatingOut: boolean;
  relativeAge: string;
  selectedIds: Set<string>;
  onClick: () => void;
  onSelect: () => void;
  onAnimationEnd: () => void;
}

export function InboxItemRow({
  thing,
  isFocused,
  isSelected,
  isAnimatingOut,
  relativeAge,
  selectedIds,
  onClick,
  onSelect,
  onAnimationEnd,
}: InboxItemRowProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: thing.id,
    data: {
      type: "inbox-item",
      thingId: thing.id,
      selectedIds: selectedIds.size > 0 ? [...selectedIds] : [thing.id],
    },
  });

  const icon =
    thing.type === "task" ? (
      <Zap size={14} className="text-blue-400" />
    ) : (
      <BookOpen size={14} className="text-amber-400" />
    );

  return (
    <div
      ref={setNodeRef}
      onClick={onClick}
      onAnimationEnd={isAnimatingOut ? onAnimationEnd : undefined}
      {...listeners}
      {...attributes}
      className={`
        group flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer
        transition-colors duration-200
        ${isDragging ? "opacity-30" : ""}
        ${isFocused
          ? "bg-blue-500/15 border border-blue-500/30"
          : isSelected
            ? "bg-white/[0.07] border border-white/10"
            : "border border-transparent hover:bg-white/[0.06]"
        }
      `}
      style={
        isAnimatingOut
          ? {
              animation:
                "inboxSlideOut 300ms cubic-bezier(0.4, 0, 1, 1) forwards",
            }
          : undefined
      }
    >
      {/* Checkbox */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onSelect();
        }}
        onPointerDown={(e) => e.stopPropagation()}
        className={`
          flex-shrink-0 w-4 h-4 rounded border flex items-center justify-center
          transition-all duration-150
          ${isSelected || isFocused
            ? "opacity-100"
            : "opacity-0 group-hover:opacity-100"
          }
          ${isSelected
            ? "bg-blue-500 border-blue-400"
            : "border-white/30 hover:border-white/50"
          }
        `}
      >
        {isSelected && (
          <svg
            width="10"
            height="10"
            viewBox="0 0 10 10"
            fill="none"
            className="text-white"
          >
            <path
              d="M2 5L4 7L8 3"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </button>

      {/* Type icon */}
      <div className="flex-shrink-0">{icon}</div>

      {/* Title */}
      <span className="flex-1 min-w-0 text-sm text-white/90 truncate">
        {thing.title}
      </span>

      {/* Source pill */}
      {thing.source && thing.source !== "Brett" && (
        <span className="flex-shrink-0 text-[11px] text-white/40 px-1.5 py-0.5 rounded bg-white/5">
          {thing.source}
        </span>
      )}

      {/* Relative age */}
      <span className="flex-shrink-0 text-xs text-white/30 tabular-nums">
        {relativeAge}
      </span>
    </div>
  );
}
