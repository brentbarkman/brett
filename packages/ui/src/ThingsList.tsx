import React, { useRef, useState, useEffect, useCallback, useMemo } from "react";
import type { Thing, NavList } from "@brett/types";
import { ThingCard } from "./ThingCard";
import { SectionHeader } from "./SectionHeader";
import { QuickAddInput, type QuickAddInputHandle } from "./QuickAddInput";
import { useListKeyboardNav } from "./useListKeyboardNav";

interface ThingsListProps {
  things: Thing[];
  lists: NavList[];
  onItemClick: (thing: Thing) => void;
  onToggle?: (id: string) => void;
  onAdd: (title: string, listId: string | null) => void;
  onAddContent?: (url: string) => void;
  onTriageOpen?: (mode: "list-first" | "date-first", ids: string[], thing?: { listId?: string | null; dueDate?: string; dueDatePrecision?: "day" | "week" | null }) => void;
  /** Called when keyboard nav changes focused item (for live detail panel updates) */
  onFocusChange?: (thing: Thing) => void;
  /** Optional element rendered at the top of the card (e.g. all-completed banner) */
  header?: React.ReactNode;
  activeFilter?: string;
}

export function ThingsList({ things, lists, onItemClick, onToggle, onAdd, onAddContent, onTriageOpen, onFocusChange, header, activeFilter }: ThingsListProps) {
  // ── Deferred toggle: batch mutations so the list stays stable during rapid-fire ──
  const pendingToggles = useRef<Set<string>>(new Set());
  const freezeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleToggleWithFreeze = useCallback((id: string) => {
    pendingToggles.current.add(id);
    // Reset timer — fire all mutations 600ms after last click
    if (freezeTimer.current) clearTimeout(freezeTimer.current);
    freezeTimer.current = setTimeout(() => {
      const ids = [...pendingToggles.current];
      pendingToggles.current = new Set();
      ids.forEach(toggleId => onToggle?.(toggleId));
    }, 600);
  }, [onToggle]);

  useEffect(() => {
    return () => {
      if (freezeTimer.current) clearTimeout(freezeTimer.current);
    };
  }, []);

  const { uncompleted, done, grouped, allItems } = useMemo(() => {
    const uncompleted = things.filter((t) => !t.isCompleted);
    const done = things.filter((t) => t.isCompleted);
    const grouped = {
      overdue: uncompleted.filter((t) => t.urgency === "overdue"),
      today: uncompleted.filter((t) => t.urgency === "today"),
      this_week: uncompleted.filter((t) => t.urgency === "this_week"),
    };
    const allItems = [...grouped.overdue, ...grouped.today, ...grouped.this_week, ...done];
    return { uncompleted, done, grouped, allItems };
  }, [things]);
  const quickAddRef = useRef<QuickAddInputHandle>(null);

  const { focusedIndex, setFocusedIndex } = useListKeyboardNav({
    items: allItems,
    onItemClick,
    onToggle: handleToggleWithFreeze,
    onFocusChange,
    onFocusAdd: () => quickAddRef.current?.focus(),
    onExtraKey: (e, focusedThing) => {
      if (!focusedThing || !onTriageOpen) return false;
      if (e.key === "l") {
        e.preventDefault();
        onTriageOpen("list-first", [focusedThing.id], { listId: focusedThing.listId, dueDate: focusedThing.dueDate, dueDatePrecision: focusedThing.dueDatePrecision });
        return true;
      }
      if (e.key === "d") {
        e.preventDefault();
        onTriageOpen("date-first", [focusedThing.id], { listId: focusedThing.listId, dueDate: focusedThing.dueDate, dueDatePrecision: focusedThing.dueDatePrecision });
        return true;
      }
      return false;
    },
  });

  const handleItemClick = useCallback((thing: Thing) => {
    const idx = allItems.findIndex((t) => t.id === thing.id);
    if (idx !== -1) setFocusedIndex(idx);
    onItemClick(thing);
  }, [allItems, onItemClick, setFocusedIndex]);

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
            <Section title="Overdue" things={grouped.overdue} onItemClick={handleItemClick} onToggle={handleToggleWithFreeze} focusedIndex={focusedIndex} indexOffset={overdueOffset} />
          )}
          {grouped.today.length > 0 && (
            <Section title="Today" things={grouped.today} onItemClick={handleItemClick} onToggle={handleToggleWithFreeze} focusedIndex={focusedIndex} indexOffset={todayOffset} />
          )}
          {grouped.this_week.length > 0 && (
            <Section title="This Week" things={grouped.this_week} onItemClick={handleItemClick} onToggle={handleToggleWithFreeze} focusedIndex={focusedIndex} indexOffset={thisWeekOffset} />
          )}

          {hasUncompleted && (
            <QuickAddInput ref={quickAddRef} placeholder={activeFilter === "Content" ? "Paste a link..." : "Add a task..."} onAdd={(title) => onAdd(title, lists[0]?.id ?? null)} onAddContent={onAddContent} />
          )}

          {done.length > 0 && (
            <div
              style={doneIsNew ? {
                animation: "sectionEnter 450ms cubic-bezier(0.16, 1, 0.3, 1) forwards",
                animationDelay: "80ms",
                opacity: 0,
              } : undefined}
            >
              <Section title="Done Today" things={done} onItemClick={handleItemClick} onToggle={handleToggleWithFreeze} focusedIndex={focusedIndex} indexOffset={doneOffset} />
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
      <SectionHeader title={title} />
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
