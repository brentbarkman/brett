import React, { useRef, useState, useEffect } from "react";
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
  /** When true, skip the glass card wrapper (parent provides it) */
  bare?: boolean;
  onReconnect?: (sourceId: string) => void;
  reconnectPendingSourceId?: string;
  onInstallUpdate?: () => void;
}

export function ThingsList({ things, lists, onItemClick, onToggle, onAdd, onAddContent, onTriageOpen, onFocusChange, header, activeFilter, bare, onReconnect, reconnectPendingSourceId, onInstallUpdate }: ThingsListProps) {
  // ── Deferred toggle: batch mutations so the list stays stable during rapid-fire ──
  const pendingToggles = useRef<Set<string>>(new Set());
  const freezeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleToggleWithFreeze = (id: string) => {
    pendingToggles.current.add(id);
    // Reset timer — fire all mutations 600ms after last click
    if (freezeTimer.current) clearTimeout(freezeTimer.current);
    freezeTimer.current = setTimeout(() => {
      const ids = [...pendingToggles.current];
      pendingToggles.current = new Set();
      ids.forEach(toggleId => onToggle?.(toggleId));
    }, 600);
  };

  useEffect(() => {
    return () => {
      if (freezeTimer.current) clearTimeout(freezeTimer.current);
    };
  }, []);

  const { uncompleted, done, grouped, allItems } = (() => {
    const uncompleted = things.filter((t) => !t.isCompleted);
    const done = things.filter((t) => t.isCompleted);
    const grouped = {
      overdue: uncompleted.filter((t) => t.urgency === "overdue"),
      today: uncompleted.filter((t) => t.urgency === "today"),
      this_week: uncompleted.filter((t) => t.urgency === "this_week"),
    };
    const allItems = [...grouped.overdue, ...grouped.today, ...grouped.this_week, ...done];
    return { uncompleted, done, grouped, allItems };
  })();
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

  const handleItemClick = (thing: Thing) => {
    const idx = allItems.findIndex((t) => t.id === thing.id);
    if (idx !== -1) setFocusedIndex(idx);
    onItemClick(thing);
  };

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

  const cardClass = bare ? "" : "bg-black/40 backdrop-blur-xl rounded-xl border border-white/10 p-4";

  return (
    <div className="flex flex-col gap-4 pb-20">
      <div className={cardClass}>
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
            <Section title="Overdue" things={grouped.overdue} onItemClick={handleItemClick} onToggle={handleToggleWithFreeze} focusedIndex={focusedIndex} indexOffset={overdueOffset} onReconnect={onReconnect} reconnectPendingSourceId={reconnectPendingSourceId} onInstallUpdate={onInstallUpdate} />
          )}
          {grouped.today.length > 0 && (
            <Section title="Today" things={grouped.today} onItemClick={handleItemClick} onToggle={handleToggleWithFreeze} focusedIndex={focusedIndex} indexOffset={todayOffset} onReconnect={onReconnect} reconnectPendingSourceId={reconnectPendingSourceId} onInstallUpdate={onInstallUpdate} />
          )}
          {grouped.this_week.length > 0 && (
            <Section title="This Week" things={grouped.this_week} onItemClick={handleItemClick} onToggle={handleToggleWithFreeze} focusedIndex={focusedIndex} indexOffset={thisWeekOffset} onReconnect={onReconnect} reconnectPendingSourceId={reconnectPendingSourceId} onInstallUpdate={onInstallUpdate} />
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
              <Section title="Done Today" things={done} onItemClick={handleItemClick} onToggle={handleToggleWithFreeze} focusedIndex={focusedIndex} indexOffset={doneOffset} onReconnect={onReconnect} reconnectPendingSourceId={reconnectPendingSourceId} onInstallUpdate={onInstallUpdate} />
            </div>
          )}
        </div>
      </div>

      {/* Keyboard hint bar */}
      {allItems.length > 0 && (
        <div className="flex items-center justify-center gap-3 text-[10px] text-white/30 bg-black/20 backdrop-blur-xl rounded-lg px-4 py-2 mx-auto w-fit">
          {["j/k navigate", "e done", "l list", "d date", "n add"].map((hint) => {
            const spaceIdx = hint.indexOf(" ");
            if (spaceIdx === -1) return <span key={hint}>{hint}</span>;
            const key = hint.slice(0, spaceIdx);
            const desc = hint.slice(spaceIdx + 1);
            return (
              <span key={hint} className="flex items-center gap-1">
                <kbd className="bg-white/10 px-1.5 py-0.5 rounded text-white/50 text-[10px]">{key}</kbd>
                <span>{desc}</span>
              </span>
            );
          })}
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
  onReconnect,
  reconnectPendingSourceId,
  onInstallUpdate,
}: {
  title: string;
  things: Thing[];
  onItemClick: (thing: Thing) => void;
  onToggle?: (id: string) => void;
  focusedIndex: number;
  indexOffset: number;
  onReconnect?: (sourceId: string) => void;
  reconnectPendingSourceId?: string;
  onInstallUpdate?: () => void;
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
            onReconnect={item.sourceId?.startsWith("relink:") && onReconnect
              ? () => onReconnect(item.sourceId!)
              : undefined}
            reconnectPending={item.sourceId === reconnectPendingSourceId}
            onInstallUpdate={item.sourceId === "system:update" ? onInstallUpdate : undefined}
          />
        ))}
      </div>
    </div>
  );
}
