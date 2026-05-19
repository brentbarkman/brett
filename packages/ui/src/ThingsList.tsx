import React, { useRef, useState } from "react";
import type { Thing, NavList } from "@brett/types";
import { ThingCard } from "./ThingCard";
import { SectionHeader } from "./SectionHeader";
import { CollapsibleSection } from "./CollapsibleSection";
import { QuickAddInput, type QuickAddInputHandle } from "./QuickAddInput";
import { useListKeyboardNav } from "./useListKeyboardNav";
import { useDeferredToggle } from "./useDeferredToggle";

interface ThingsListProps {
  things: Thing[];
  lists: NavList[];
  onItemClick: (thing: Thing) => void;
  onToggle?: (id: string) => void;
  onAdd: (title: string, listId: string | null) => void;
  onAddContent?: (url: string) => void;
  onTriageOpen?: (
    mode: "list-first" | "date-first" | "list-only" | "date-only",
    ids: string[],
    thing?: { listId?: string | null; dueDate?: string; dueDatePrecision?: "day" | "week" | null },
    anchorEl?: HTMLElement | null,
  ) => void;
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
  /** When set, the matching section's in-flow header is rendered with
   * `visibility: hidden` so it still occupies layout space but doesn't
   * duplicate the chrome active-section header above the inner scroll. */
  hiddenHeaderKey?: string | null;
  /** Controlled open-state map for sections that should be collapsible.
   * Keys are section keys (e.g. "this-week", "this-weekend", "done-today");
   * absent keys = section is always-expanded (Overdue, Today). When the
   * parent owns this map (persisting state per-user via
   * useLocalStorageBoolean), a section with `false` hides its items and
   * shows a chevron header. */
  collapsibleSections?: Record<string, { open: boolean; onOpenChange: (open: boolean) => void }>;
}

export function ThingsList({ things, lists, onItemClick, onToggle, onAdd, onAddContent, onTriageOpen, onFocusChange, header, activeFilter, bare, onReconnect, reconnectPendingSourceId, onInstallUpdate, hiddenHeaderKey, collapsibleSections }: ThingsListProps) {
  // Shared across ThingsList, InboxView, and UpcomingView — see CLAUDE.md
  // list-consistency rule.
  const handleToggleWithFreeze = useDeferredToggle(onToggle);

  // On Sat/Sun, "This Weekend" is what's imminent — render it before
  // "This Week" (the upcoming workweek). On Mon-Fri, the workweek comes
  // first chronologically.
  const isWeekendNow = (() => {
    const dow = new Date().getUTCDay();
    return dow === 0 || dow === 6;
  })();

  const { uncompleted, done, grouped, allItems } = (() => {
    const uncompleted = things.filter((t) => !t.isCompleted);
    const done = things.filter((t) => t.isCompleted);
    const grouped = {
      overdue: uncompleted.filter((t) => t.urgency === "overdue"),
      today: uncompleted.filter((t) => t.urgency === "today"),
      this_week: uncompleted.filter((t) => t.urgency === "this_week"),
      this_weekend: uncompleted.filter((t) => t.urgency === "this_weekend"),
    };
    const weekChunks = isWeekendNow
      ? [...grouped.this_weekend, ...grouped.this_week]
      : [...grouped.this_week, ...grouped.this_weekend];
    const allItems = [...grouped.overdue, ...grouped.today, ...weekChunks, ...done];
    return { uncompleted, done, grouped, allItems };
  })();
  const quickAddRef = useRef<QuickAddInputHandle>(null);
  const cardEls = useRef<Map<string, HTMLDivElement>>(new Map());

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
        const anchor = cardEls.current.get(focusedThing.id) ?? null;
        onTriageOpen("list-only", [focusedThing.id], { listId: focusedThing.listId, dueDate: focusedThing.dueDate, dueDatePrecision: focusedThing.dueDatePrecision }, anchor);
        return true;
      }
      if (e.key === "d") {
        e.preventDefault();
        const anchor = cardEls.current.get(focusedThing.id) ?? null;
        onTriageOpen("date-only", [focusedThing.id], { listId: focusedThing.listId, dueDate: focusedThing.dueDate, dueDatePrecision: focusedThing.dueDatePrecision }, anchor);
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

  // Compute running offset so Section knows which indices are "focused".
  // The order here MUST match the `allItems` concat above — weekend comes
  // before week on Sat/Sun, otherwise after.
  let offset = 0;
  const overdueOffset = offset;
  offset += grouped.overdue.length;
  const todayOffset = offset;
  offset += grouped.today.length;
  const firstWeekChunkOffset = offset;
  const firstWeekChunkLength = isWeekendNow ? grouped.this_weekend.length : grouped.this_week.length;
  offset += firstWeekChunkLength;
  const secondWeekChunkOffset = offset;
  offset += isWeekendNow ? grouped.this_week.length : grouped.this_weekend.length;
  const doneOffset = offset;
  const thisWeekOffset = isWeekendNow ? secondWeekChunkOffset : firstWeekChunkOffset;
  const thisWeekendOffset = isWeekendNow ? firstWeekChunkOffset : secondWeekChunkOffset;

  const cardClass = bare ? "" : "bg-black/40 backdrop-blur-xl rounded-xl border border-white/10 p-4";

  return (
    <div className="flex flex-col gap-4 pb-20">
      <div className={cardClass}>
        <div className="flex flex-col gap-4">
          {header && <div>{header}</div>}

          {grouped.overdue.length > 0 && (
            <Section sectionKey="overdue" title="Overdue" things={grouped.overdue} onItemClick={handleItemClick} onToggle={handleToggleWithFreeze} focusedIndex={focusedIndex} indexOffset={overdueOffset} onReconnect={onReconnect} reconnectPendingSourceId={reconnectPendingSourceId} onInstallUpdate={onInstallUpdate} cardEls={cardEls} hideHeader={hiddenHeaderKey === "overdue"} collapse={collapsibleSections?.["overdue"]} />
          )}
          {grouped.today.length > 0 && (
            <Section sectionKey="today" title="Today" things={grouped.today} onItemClick={handleItemClick} onToggle={handleToggleWithFreeze} focusedIndex={focusedIndex} indexOffset={todayOffset} onReconnect={onReconnect} reconnectPendingSourceId={reconnectPendingSourceId} onInstallUpdate={onInstallUpdate} cardEls={cardEls} hideHeader={hiddenHeaderKey === "today"} collapse={collapsibleSections?.["today"]} />
          )}
          {isWeekendNow ? (
            <>
              {grouped.this_weekend.length > 0 && (
                <Section sectionKey="this-weekend" title="This Weekend" things={grouped.this_weekend} onItemClick={handleItemClick} onToggle={handleToggleWithFreeze} focusedIndex={focusedIndex} indexOffset={thisWeekendOffset} onReconnect={onReconnect} reconnectPendingSourceId={reconnectPendingSourceId} onInstallUpdate={onInstallUpdate} cardEls={cardEls} hideHeader={hiddenHeaderKey === "this-weekend"} collapse={collapsibleSections?.["this-weekend"]} />
              )}
              {grouped.this_week.length > 0 && (
                <Section sectionKey="this-week" title="This Week" things={grouped.this_week} onItemClick={handleItemClick} onToggle={handleToggleWithFreeze} focusedIndex={focusedIndex} indexOffset={thisWeekOffset} onReconnect={onReconnect} reconnectPendingSourceId={reconnectPendingSourceId} onInstallUpdate={onInstallUpdate} cardEls={cardEls} hideHeader={hiddenHeaderKey === "this-week"} collapse={collapsibleSections?.["this-week"]} />
              )}
            </>
          ) : (
            <>
              {grouped.this_week.length > 0 && (
                <Section sectionKey="this-week" title="This Week" things={grouped.this_week} onItemClick={handleItemClick} onToggle={handleToggleWithFreeze} focusedIndex={focusedIndex} indexOffset={thisWeekOffset} onReconnect={onReconnect} reconnectPendingSourceId={reconnectPendingSourceId} onInstallUpdate={onInstallUpdate} cardEls={cardEls} hideHeader={hiddenHeaderKey === "this-week"} collapse={collapsibleSections?.["this-week"]} />
              )}
              {grouped.this_weekend.length > 0 && (
                <Section sectionKey="this-weekend" title="This Weekend" things={grouped.this_weekend} onItemClick={handleItemClick} onToggle={handleToggleWithFreeze} focusedIndex={focusedIndex} indexOffset={thisWeekendOffset} onReconnect={onReconnect} reconnectPendingSourceId={reconnectPendingSourceId} onInstallUpdate={onInstallUpdate} cardEls={cardEls} hideHeader={hiddenHeaderKey === "this-weekend"} collapse={collapsibleSections?.["this-weekend"]} />
              )}
            </>
          )}

          {hasUncompleted && (
            <QuickAddInput ref={quickAddRef} placeholder={activeFilter === "Content" ? "Paste a link..." : "Add a task..."} onAdd={(title) => onAdd(title, lists[0]?.id ?? null)} onAddContent={onAddContent} />
          )}

          {done.length > 0 && (
            <div>
              <Section sectionKey="done-today" title="Done Today" things={done} onItemClick={handleItemClick} onToggle={handleToggleWithFreeze} focusedIndex={focusedIndex} indexOffset={doneOffset} onReconnect={onReconnect} reconnectPendingSourceId={reconnectPendingSourceId} onInstallUpdate={onInstallUpdate} cardEls={cardEls} hideHeader={hiddenHeaderKey === "done-today"} collapse={collapsibleSections?.["done-today"]} />
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
  sectionKey,
  title,
  things,
  onItemClick,
  onToggle,
  focusedIndex,
  indexOffset,
  onReconnect,
  reconnectPendingSourceId,
  onInstallUpdate,
  cardEls,
  hideHeader,
  collapse,
}: {
  /** Stable identifier matched against TodayView's section list to drive the
   * chrome active-section header. The chrome header pins at the top of the
   * card; this in-flow header acts as a divider that scrolls with the section
   * and gets clipped by the inner scroll's `overflow-hidden` as the next
   * section takes over. */
  sectionKey: string;
  title: string;
  things: Thing[];
  onItemClick: (thing: Thing) => void;
  onToggle?: (id: string) => void;
  focusedIndex: number;
  indexOffset: number;
  onReconnect?: (sourceId: string) => void;
  reconnectPendingSourceId?: string;
  onInstallUpdate?: () => void;
  cardEls: React.RefObject<Map<string, HTMLDivElement>>;
  /** When the chrome above the inner scroll is already showing this section's
   * header, hide the in-flow copy with `visibility: hidden` so we don't
   * duplicate. Layout space is preserved so the chrome→in-flow handoff during
   * scroll doesn't jump. */
  hideHeader?: boolean;
  /** When provided, renders a CollapsibleSection header. Items render only
   * when `open` is true. The chrome active-section header in TodayView
   * already skips collapsed sections because there are no items to scroll
   * past. */
  collapse?: { open: boolean; onOpenChange: (open: boolean) => void };
}) {
  const items = (
    <div className="flex flex-col">
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
          onElementRef={(el) => {
            if (el) cardEls.current.set(item.id, el);
            else cardEls.current.delete(item.id);
          }}
        />
      ))}
    </div>
  );

  // Collapsible variant: header is a chevron button, items render only when
  // open. `hideHeader` doesn't apply — the chrome active-section header in
  // TodayView never tracks collapsed sections.
  if (collapse) {
    return (
      <div data-section-key={sectionKey}>
        <CollapsibleSection
          title={title}
          count={things.length}
          open={collapse.open}
          onOpenChange={collapse.onOpenChange}
        >
          {items}
        </CollapsibleSection>
      </div>
    );
  }

  return (
    <div data-section-key={sectionKey}>
      {/* For non-active sections the in-flow header is a visible divider.
       *  Its natural mb-2 gives the same 8px breathing room below the rule
       *  as the chrome active-section header above the inner scroll, so
       *  spacing is consistent across sections. For the active section we
       *  drop the header entirely so items sit flush at the top of
       *  data-section-key — the chrome already shows the name. TodayView
       *  compensates scrollTop on transitions so the layout shift doesn't
       *  pop the viewport. */}
      {!hideHeader && (
        <SectionHeader title={title} count={things.length} />
      )}
      {items}
    </div>
  );
}
