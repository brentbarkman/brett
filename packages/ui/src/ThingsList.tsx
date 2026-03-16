import React, { useState, useRef, useEffect, useCallback } from "react";
import { Plus } from "lucide-react";
import type { Thing, NavList } from "@brett/types";
import { ThingCard } from "./ThingCard";

interface ThingsListProps {
  things: Thing[];
  lists: NavList[];
  onItemClick: (thing: Thing) => void;
  onToggle?: (id: string) => void;
  onAdd: (title: string, listId: string | null) => void;
  onTriageOpen?: (mode: "list-first" | "date-first", ids: string[], thing?: { listId?: string | null; dueDate?: string; dueDatePrecision?: "day" | "week" | null }) => void;
  /** Optional element rendered at the top of the card (e.g. all-completed banner) */
  header?: React.ReactNode;
}

export function ThingsList({ things, lists, onItemClick, onToggle, onAdd, onTriageOpen, header }: ThingsListProps) {
  const uncompleted = things.filter((t) => !t.isCompleted);
  const done = things.filter((t) => t.isCompleted);

  const grouped = {
    overdue: uncompleted.filter((t) => t.urgency === "overdue"),
    today: uncompleted.filter((t) => t.urgency === "today"),
    this_week: uncompleted.filter((t) => t.urgency === "this_week"),
  };

  // Flat list of all items for keyboard navigation
  const allItems = [...grouped.overdue, ...grouped.today, ...grouped.this_week, ...done];
  const [focusedIndex, setFocusedIndex] = useState(0);
  const focusedThing = allItems[focusedIndex] ?? null;

  const handleItemClick = useCallback((thing: Thing) => {
    const idx = allItems.findIndex((t) => t.id === thing.id);
    if (idx !== -1) setFocusedIndex(idx);
    onItemClick(thing);
  }, [allItems, onItemClick]);

  // Reset focused index when items change
  useEffect(() => {
    setFocusedIndex((i) => Math.min(i, Math.max(allItems.length - 1, 0)));
  }, [allItems.length]);

  // Keyboard handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        document.activeElement instanceof HTMLInputElement ||
        document.activeElement instanceof HTMLTextAreaElement
      ) {
        return;
      }

      const key = e.key;

      if (key === "ArrowDown" || key === "j") {
        e.preventDefault();
        setFocusedIndex((i) => Math.min(i + 1, allItems.length - 1));
        return;
      }

      if (key === "ArrowUp" || key === "k") {
        e.preventDefault();
        setFocusedIndex((i) => Math.max(i - 1, 0));
        return;
      }

      if (key === "Enter") {
        e.preventDefault();
        if (focusedThing) onItemClick(focusedThing);
        return;
      }

      if (key === "e") {
        e.preventDefault();
        if (focusedThing && onToggle) onToggle(focusedThing.id);
        return;
      }

      if (key === "l") {
        e.preventDefault();
        if (focusedThing && onTriageOpen) onTriageOpen("list-first", [focusedThing.id], { listId: focusedThing.listId, dueDate: focusedThing.dueDate, dueDatePrecision: focusedThing.dueDatePrecision });
        return;
      }

      if (key === "d") {
        e.preventDefault();
        if (focusedThing && onTriageOpen) onTriageOpen("date-first", [focusedThing.id], { listId: focusedThing.listId, dueDate: focusedThing.dueDate, dueDatePrecision: focusedThing.dueDatePrecision });
        return;
      }

      if (key === "n") {
        e.preventDefault();
        quickAddRef.current?.focus();
        return;
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [focusedIndex, focusedThing, allItems, onItemClick, onToggle, onTriageOpen]);

  const quickAddRef = useRef<HTMLInputElement>(null);

  const hasUncompleted = uncompleted.length > 0;

  // Track whether header/done section just appeared (for enter animations)
  const hadHeader = useRef(!!header);
  const headerIsNew = !!header && !hadHeader.current;
  useEffect(() => { hadHeader.current = !!header; }, [header]);

  const hadDone = useRef(done.length > 0);
  const doneIsNew = done.length > 0 && !hadDone.current;
  useEffect(() => { hadDone.current = done.length > 0; }, [done.length]);

  // Compute running offset so Section knows which indices are "focused"
  let offset = 0;
  const overdueOffset = offset;
  offset += grouped.overdue.length;
  const todayOffset = offset;
  offset += grouped.today.length;
  const thisWeekOffset = offset;
  offset += grouped.this_week.length;
  const doneOffset = offset;

  return (
    <div className="flex flex-col gap-4 pb-20">
      <div className="bg-black/30 backdrop-blur-xl rounded-xl border border-white/10 p-4">
        <div className="flex flex-col gap-4">
          {header && (
            <div
              style={headerIsNew ? {
                animation: "sectionEnter 450ms cubic-bezier(0.16, 1, 0.3, 1) forwards",
              } : undefined}
            >
              {header}
            </div>
          )}

          {grouped.overdue.length > 0 && (
            <Section title="Overdue" things={grouped.overdue} onItemClick={handleItemClick} onToggle={onToggle} focusedIndex={focusedIndex} indexOffset={overdueOffset} />
          )}
          {grouped.today.length > 0 && (
            <Section title="Today" things={grouped.today} onItemClick={handleItemClick} onToggle={onToggle} focusedIndex={focusedIndex} indexOffset={todayOffset} />
          )}
          {grouped.this_week.length > 0 && (
            <Section title="This Week" things={grouped.this_week} onItemClick={handleItemClick} onToggle={onToggle} focusedIndex={focusedIndex} indexOffset={thisWeekOffset} />
          )}

          {hasUncompleted && (
            <InlineQuickAdd ref={quickAddRef} lists={lists} onAdd={onAdd} />
          )}

          {done.length > 0 && (
            <div
              style={doneIsNew ? {
                animation: "sectionEnter 450ms cubic-bezier(0.16, 1, 0.3, 1) forwards",
                animationDelay: "80ms",
                opacity: 0,
              } : undefined}
            >
              <Section title="Done Today" things={done} onItemClick={handleItemClick} onToggle={onToggle} focusedIndex={focusedIndex} indexOffset={doneOffset} />
            </div>
          )}
        </div>
      </div>

      {/* Keyboard hint bar */}
      {allItems.length > 0 && (
        <div className="flex items-center justify-center gap-4 text-[10px] text-white/20 font-mono">
          <span>j/k navigate</span>
          <span>e done</span>
          <span>l list</span>
          <span>d date</span>
          <span>n add</span>
        </div>
      )}

      <style>{`
        @keyframes sectionEnter {
          from {
            opacity: 0;
            transform: translateY(12px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
    </div>
  );
}

function Section({
  title,
  things,
  onItemClick,
  onToggle,
  focusedIndex,
  indexOffset,
}: {
  title: string;
  things: Thing[];
  onItemClick: (thing: Thing) => void;
  onToggle?: (id: string) => void;
  focusedIndex: number;
  indexOffset: number;
}) {
  return (
    <div>
      <div className="flex items-center gap-3 mb-2">
        <h3 className="font-mono text-xs uppercase tracking-wider text-white/40 font-semibold flex-shrink-0">
          {title}
        </h3>
        <div className="h-px bg-white/10 flex-1" />
      </div>
      <div className="flex flex-col gap-2">
        {things.map((item, i) => (
          <ThingCard
            key={item.id}
            thing={item}
            onClick={() => onItemClick(item)}
            onToggle={onToggle}
            isFocused={focusedIndex === indexOffset + i}
          />
        ))}
      </div>
    </div>
  );
}

const InlineQuickAdd = React.forwardRef<
  HTMLInputElement,
  {
    lists: NavList[];
    onAdd: (title: string, listId: string | null) => void;
  }
>(function InlineQuickAdd({ lists, onAdd }, ref) {
  const [title, setTitle] = useState("");
  const [isFocused, setIsFocused] = useState(false);
  const localRef = useRef<HTMLInputElement>(null);
  const inputRef = (ref as React.RefObject<HTMLInputElement>) || localRef;

  const handleSubmit = () => {
    if (!title.trim()) return;
    onAdd(title.trim(), lists[0]?.id ?? null);
    setTitle("");
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSubmit();
    }
    if (e.key === "Escape") {
      setTitle("");
      inputRef.current?.blur();
    }
  };

  return (
    <div
      className={`
        flex items-center gap-2.5 px-3 py-2 rounded-lg transition-all
        ${isFocused
          ? "bg-white/5 border border-blue-500/20"
          : "border border-transparent hover:bg-white/[0.03]"
        }
      `}
    >
      <Plus size={15} className={isFocused ? "text-blue-400" : "text-white/20"} />
      <input
        ref={inputRef}
        type="text"
        placeholder="Add a task..."
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={() => setIsFocused(true)}
        onBlur={() => { if (!title) setIsFocused(false); }}
        className="flex-1 bg-transparent border-none outline-none text-white placeholder:text-white/20 text-sm"
      />
      {isFocused && title.trim() && (
        <span className="text-[10px] text-white/25 font-mono">enter</span>
      )}
    </div>
  );
});
