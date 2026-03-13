import React, { useState, useRef, useEffect } from "react";
import { Plus } from "lucide-react";
import type { Thing, NavList } from "@brett/types";
import { ThingCard } from "./ThingCard";

interface ThingsListProps {
  things: Thing[];
  lists: NavList[];
  onItemClick: (thing: Thing) => void;
  onToggle?: (id: string) => void;
  onAdd: (title: string, listId: string | null) => void;
  /** Optional element rendered at the top of the card (e.g. all-completed banner) */
  header?: React.ReactNode;
}

export function ThingsList({ things, lists, onItemClick, onToggle, onAdd, header }: ThingsListProps) {
  const uncompleted = things.filter((t) => !t.isCompleted);
  const done = things.filter((t) => t.isCompleted);

  const grouped = {
    overdue: uncompleted.filter((t) => t.urgency === "overdue"),
    today: uncompleted.filter((t) => t.urgency === "today"),
    this_week: uncompleted.filter((t) => t.urgency === "this_week"),
    next_week: uncompleted.filter((t) => t.urgency === "next_week"),
  };

  const hasUncompleted = uncompleted.length > 0;

  // Track whether header/done section just appeared (for enter animations)
  const hadHeader = useRef(!!header);
  const headerIsNew = !!header && !hadHeader.current;
  useEffect(() => { hadHeader.current = !!header; }, [header]);

  const hadDone = useRef(done.length > 0);
  const doneIsNew = done.length > 0 && !hadDone.current;
  useEffect(() => { hadDone.current = done.length > 0; }, [done.length]);

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
            <Section title="Overdue" things={grouped.overdue} onItemClick={onItemClick} onToggle={onToggle} />
          )}
          {grouped.today.length > 0 && (
            <Section title="Today" things={grouped.today} onItemClick={onItemClick} onToggle={onToggle} />
          )}
          {grouped.this_week.length > 0 && (
            <Section title="This Week" things={grouped.this_week} onItemClick={onItemClick} onToggle={onToggle} />
          )}
          {grouped.next_week.length > 0 && (
            <Section title="Next Week" things={grouped.next_week} onItemClick={onItemClick} onToggle={onToggle} />
          )}

          {hasUncompleted && (
            <InlineQuickAdd lists={lists} onAdd={onAdd} />
          )}

          {done.length > 0 && (
            <div
              style={doneIsNew ? {
                animation: "sectionEnter 450ms cubic-bezier(0.16, 1, 0.3, 1) forwards",
                animationDelay: "80ms",
                opacity: 0,
              } : undefined}
            >
              <Section title="Done" things={done} onItemClick={onItemClick} onToggle={onToggle} />
            </div>
          )}
        </div>
      </div>

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
}: {
  title: string;
  things: Thing[];
  onItemClick: (thing: Thing) => void;
  onToggle?: (id: string) => void;
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
        {things.map((item) => (
          <ThingCard
            key={item.id}
            thing={item}
            onClick={() => onItemClick(item)}
            onToggle={onToggle}
          />
        ))}
      </div>
    </div>
  );
}

function InlineQuickAdd({
  lists,
  onAdd,
}: {
  lists: NavList[];
  onAdd: (title: string, listId: string | null) => void;
}) {
  const [title, setTitle] = useState("");
  const [isFocused, setIsFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

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
}
