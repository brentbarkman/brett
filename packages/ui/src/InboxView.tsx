import React, { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { Inbox } from "lucide-react";
import type { Thing, NavList, FilterType } from "@brett/types";
import { computeRelativeAge } from "@brett/business";
import { InboxItemRow } from "./InboxItemRow";
import { QuickAddInput, type QuickAddInputHandle } from "./QuickAddInput";
import { ItemListShell } from "./ItemListShell";
import { TypeFilter } from "./TypeFilter";

interface InboxViewProps {
  things: Thing[];
  lists: NavList[];
  onItemClick: (thing: Thing) => void;
  onToggle: (id: string) => void;
  onArchive: (ids: string[]) => void;
  onAdd: (title: string) => void;
  onAddContent?: (url: string) => void;
  onTriage: (
    ids: string[],
    updates: { listId?: string | null; dueDate?: string | null; dueDatePrecision?: "day" | "week" | null }
  ) => void;
  onTriageOpen?: (mode: "list-first" | "date-first", ids: string[], thing?: { listId?: string | null; dueDate?: string; dueDatePrecision?: "day" | "week" | null }) => void;
  onFocusChange?: (thing: Thing) => void;
  onReconnect?: (sourceId: string) => void;
  reconnectPendingSourceId?: string;
  onInstallUpdate?: () => void;
  assistantName?: string;
}

export function InboxView({
  things,
  lists,
  onItemClick,
  onToggle,
  onArchive,
  onAdd,
  onAddContent,
  onTriage,
  onTriageOpen,
  onFocusChange,
  onReconnect,
  reconnectPendingSourceId,
  onInstallUpdate,
  assistantName = "Brett",
}: InboxViewProps) {
  const [typeFilter, setTypeFilter] = useState<FilterType>("All");
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [animatingOutIds, setAnimatingOutIds] = useState<Set<string>>(
    new Set()
  );
  // Deferred toggle: batch mutations so list stays stable during rapid-fire
  const pendingToggles = useRef<Set<string>>(new Set());
  const toggleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [addInputFocused, setAddInputFocused] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const quickAddRef = useRef<QuickAddInputHandle>(null);
  const now = useRef(new Date());

  // Snapshots of items being animated out (persist through refetches)
  const animatingOutItemsRef = useRef<Map<string, Thing>>(new Map());

  // Track previous thing IDs for enter animation
  const isInitialLoadRef = useRef(true);
  const prevThingIdsRef = useRef<Set<string>>(new Set());

  // Cleanup toggle timer
  useEffect(() => {
    return () => { if (toggleTimer.current) clearTimeout(toggleTimer.current); };
  }, []);

  // Update "now" every minute for relative age
  useEffect(() => {
    const interval = setInterval(() => {
      now.current = new Date();
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  // Apply type filter
  const filteredThings = useMemo(() => {
    if (typeFilter === "All") return things;
    if (typeFilter === "Tasks") return things.filter((t) => t.type === "task");
    if (typeFilter === "Content") return things.filter((t) => t.type === "content");
    return things;
  }, [things, typeFilter]);

  // Build display list: current things + snapshotted animating-out items removed by refetch
  const displayThings = useMemo(() => {
    const currentIds = new Set(filteredThings.map((t) => t.id));
    const result = [...filteredThings];
    for (const [id, item] of animatingOutItemsRef.current) {
      if (!currentIds.has(id)) {
        result.push(item);
      }
    }
    return result;
  }, [filteredThings]);

  // ── Temporal grouping (must come before activeThings so keyboard nav matches visual order) ──
  type TimeBucket = "NEW" | "EARLIER TODAY" | "YESTERDAY" | "THIS WEEK" | "OLDER";
  const bucketOrder: TimeBucket[] = ["NEW", "EARLIER TODAY", "YESTERDAY", "THIS WEEK", "OLDER"];

  const getTimeBucket = useCallback((thing: Thing): TimeBucket => {
    if (!thing.createdAt) return "OLDER";
    const created = new Date(thing.createdAt);
    const diffMs = now.current.getTime() - created.getTime();
    const diffHours = diffMs / (1000 * 60 * 60);
    const today = new Date(now.current);
    today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const weekStart = new Date(today);
    weekStart.setDate(weekStart.getDate() - today.getDay());

    if (diffHours < 2 && created >= today) return "NEW";
    if (created >= today) return "EARLIER TODAY";
    if (created >= yesterday) return "YESTERDAY";
    if (created >= weekStart) return "THIS WEEK";
    return "OLDER";
  }, []);

  const groupedDisplay = useMemo(() => {
    const groups = new Map<TimeBucket, Thing[]>();
    for (const bucket of bucketOrder) {
      groups.set(bucket, []);
    }
    for (const thing of displayThings) {
      const bucket = getTimeBucket(thing);
      groups.get(bucket)!.push(thing);
    }
    return groups;
  }, [displayThings, getTimeBucket]);

  // Flat ordered list matching visual bucket order
  const orderedDisplayThings = useMemo(() => {
    const result: Thing[] = [];
    for (const bucket of bucketOrder) {
      const items = groupedDisplay.get(bucket);
      if (items && items.length > 0) result.push(...items);
    }
    return result;
  }, [groupedDisplay]);

  // Active items (for focus/selection) — excludes animating out, in visual bucket order
  const activeThings = useMemo(
    () => orderedDisplayThings.filter((t) => !animatingOutIds.has(t.id)),
    [orderedDisplayThings, animatingOutIds]
  );

  // Index map for O(1) focus lookups
  const activeIndexMap = useMemo(
    () => new Map(activeThings.map((t, i) => [t.id, i])),
    [activeThings]
  );

  // New item IDs for enter animation (skip initial load)
  const newItemIds = useMemo(() => {
    if (isInitialLoadRef.current) return new Set<string>();
    const ids = new Set<string>();
    for (const t of things) {
      if (!prevThingIdsRef.current.has(t.id)) {
        ids.add(t.id);
      }
    }
    return ids;
  }, [things]);

  // Update previous IDs after render
  useEffect(() => {
    // Only clear initial-load flag once we've actually received data
    if (things.length > 0) {
      isInitialLoadRef.current = false;
    }
    prevThingIdsRef.current = new Set(things.map((t) => t.id));
  }, [things]);

  // Clamp focus index
  useEffect(() => {
    if (focusedIndex >= activeThings.length && activeThings.length > 0) {
      setFocusedIndex(activeThings.length - 1);
    }
  }, [activeThings.length, focusedIndex]);

  const focusedThing = activeThings[focusedIndex];

  const getTargetIds = useCallback((): string[] => {
    if (selectedIds.size > 0) return [...selectedIds];
    if (focusedThing) return [focusedThing.id];
    return [];
  }, [selectedIds, focusedThing]);

  const slideOut = useCallback(
    (ids: string[]) => {
      // Snapshot items before they might disappear from refetch
      ids.forEach((id) => {
        const item = things.find((t) => t.id === id);
        if (item) animatingOutItemsRef.current.set(id, item);
      });
      setAnimatingOutIds((prev) => {
        const next = new Set(prev);
        ids.forEach((id) => next.add(id));
        return next;
      });
    },
    [things, filteredThings]
  );

  const handleAnimationEnd = useCallback(
    (id: string) => {
      animatingOutItemsRef.current.delete(id);
      setAnimatingOutIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    },
    []
  );

  // Document-level keyboard handler — works regardless of which element has focus
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept when input is focused
      if (
        document.activeElement instanceof HTMLInputElement ||
        document.activeElement instanceof HTMLTextAreaElement
      ) {
        return;
      }

      const key = e.key;

      // Navigation
      if (key === "ArrowDown" || key === "j") {
        e.preventDefault();
        if (e.shiftKey) {
          if (focusedThing) {
            setSelectedIds((prev) => {
              const next = new Set(prev);
              next.add(focusedThing.id);
              return next;
            });
          }
          setFocusedIndex((i) => Math.min(i + 1, activeThings.length - 1));
          const nextThing = activeThings[Math.min(focusedIndex + 1, activeThings.length - 1)];
          if (nextThing) {
            setSelectedIds((prev) => {
              const next = new Set(prev);
              next.add(nextThing.id);
              return next;
            });
          }
        } else {
          setFocusedIndex((i) => {
            const next = Math.min(i + 1, activeThings.length - 1);
            if (next !== i && activeThings[next] && onFocusChange) onFocusChange(activeThings[next]);
            return next;
          });
        }
        return;
      }

      if (key === "ArrowUp" || key === "k") {
        e.preventDefault();
        if (e.shiftKey) {
          if (focusedThing) {
            setSelectedIds((prev) => {
              const next = new Set(prev);
              next.add(focusedThing.id);
              return next;
            });
          }
          setFocusedIndex((i) => Math.max(i - 1, 0));
          const prevThing = activeThings[Math.max(focusedIndex - 1, 0)];
          if (prevThing) {
            setSelectedIds((prev) => {
              const next = new Set(prev);
              next.add(prevThing.id);
              return next;
            });
          }
        } else {
          setFocusedIndex((i) => {
            const next = Math.max(i - 1, 0);
            if (next !== i && activeThings[next] && onFocusChange) onFocusChange(activeThings[next]);
            return next;
          });
        }
        return;
      }

      // Select
      if (key === "x") {
        e.preventDefault();
        if (!focusedThing) return;
        setSelectedIds((prev) => {
          const next = new Set(prev);
          if (next.has(focusedThing.id)) {
            next.delete(focusedThing.id);
          } else {
            next.add(focusedThing.id);
          }
          return next;
        });
        return;
      }

      // Select all
      if (key === "a" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setSelectedIds(new Set(activeThings.map((t) => t.id)));
        return;
      }

      // Mark done
      if (key === "e") {
        e.preventDefault();
        const ids = getTargetIds();
        if (ids.length === 0) return;
        slideOut(ids);
        ids.forEach((id) => onToggle(id));
        return;
      }

      // Archive
      if (key === "#") {
        e.preventDefault();
        const ids = getTargetIds();
        if (ids.length === 0) return;
        slideOut(ids);
        onArchive(ids);
        return;
      }

      // Open detail
      if (key === "Enter") {
        e.preventDefault();
        if (focusedThing) onItemClick(focusedThing);
        return;
      }

      // Quick add
      if (key === "n") {
        e.preventDefault();
        quickAddRef.current?.focus();
        return;
      }

      // Escape — deselect (only if there's a selection)
      if (key === "Escape" && selectedIds.size > 0) {
        e.preventDefault();
        setSelectedIds(new Set());
        return;
      }

      // Triage: list-first
      if (key === "l") {
        e.preventDefault();
        const ids = getTargetIds();
        if (ids.length === 0) return;
        // Pass focused thing's values for single-item triage
        const singleThing = ids.length === 1 ? activeThings.find((t) => t.id === ids[0]) : undefined;
        onTriageOpen?.("list-first", ids, singleThing ? { listId: singleThing.listId, dueDate: singleThing.dueDate, dueDatePrecision: singleThing.dueDatePrecision } : undefined);
        return;
      }

      // Triage: date-first
      if (key === "d") {
        e.preventDefault();
        const ids = getTargetIds();
        if (ids.length === 0) return;
        const singleThing = ids.length === 1 ? activeThings.find((t) => t.id === ids[0]) : undefined;
        onTriageOpen?.("date-first", ids, singleThing ? { listId: singleThing.listId, dueDate: singleThing.dueDate, dueDatePrecision: singleThing.dueDatePrecision } : undefined);
        return;
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [
    focusedIndex,
    focusedThing,
    activeThings,
    getTargetIds,
    slideOut,
    onToggle,
    onArchive,
    onItemClick,
    onTriageOpen,
  ]);

  // Determine if all visible items share the same source (suppress redundant pills)
  const allSameSource = useMemo(() => {
    const sources = displayThings.map((t) => t.source).filter(Boolean);
    return sources.length > 0 && sources.every((s) => s === sources[0]);
  }, [displayThings]);

  const isEmpty = displayThings.length === 0;

  const inboxHeader = (
    <>
      <div className="flex items-center gap-3">
        <Inbox size={20} className="text-white/50" />
        <h2 className="text-xl font-bold text-white">Inbox</h2>
      </div>
      <TypeFilter value={typeFilter} onChange={setTypeFilter} />
    </>
  );

  const inboxHints = activeThings.length > 0
    ? ["j/k navigate", "x select", "l list", "d date", "e done", "# archive"]
    : [];

  return (
    <ItemListShell header={inboxHeader} hints={inboxHints}>
        <QuickAddInput ref={quickAddRef} placeholder="Add to inbox..." onAdd={onAdd} onAddContent={onAddContent} onFocusChange={setAddInputFocused} />

        {/* Empty state */}
        {isEmpty && (
          <div className="flex flex-col items-center justify-center py-16 gap-4">
            <div className="w-12 h-12 rounded-full bg-brett-gold/10 border border-brett-gold/20 flex items-center justify-center">
              <Inbox size={22} className="text-brett-gold" />
            </div>
            <div className="text-center">
              <h3 className="text-white font-semibold text-base mb-1">Inbox zero</h3>
              <p className="text-white/40 text-sm leading-relaxed max-w-xs">
                Nothing to triage. Add something or let {assistantName} find things for you.
              </p>
            </div>
          </div>
        )}

        {/* Item list with temporal grouping */}
        {displayThings.length > 0 && (
          <div className="flex flex-col">
            {bucketOrder.map((bucket) => {
              const items = groupedDisplay.get(bucket);
              if (!items || items.length === 0) return null;
              return (
                <React.Fragment key={bucket}>
                  <div className="flex items-center gap-3 pt-2">
                    <span className="text-[10px] uppercase tracking-[0.15em] font-semibold text-white/40 whitespace-nowrap">
                      {bucket}
                    </span>
                    <div className="flex-1 h-px bg-white/10" />
                  </div>
                  {items.map((thing) => {
                    const isOut = animatingOutIds.has(thing.id);
                    const isNewItem = newItemIds.has(thing.id);
                    const activeIdx = activeIndexMap.get(thing.id) ?? -1;

                    return (
                      <div
                        key={thing.id}
                        className="inbox-item-wrapper"
                        style={{
                          overflow: "hidden",
                          maxHeight: isOut ? 0 : 60,
                          marginBottom: isOut ? 0 : 4,
                          transition: isOut
                            ? "max-height 200ms ease-out 120ms, margin-bottom 200ms ease-out 120ms"
                            : "none",
                          animation: isNewItem
                            ? "inboxItemExpand 250ms ease-out"
                            : undefined,
                        }}
                        onTransitionEnd={(e) => {
                          if (isOut && e.propertyName === "max-height") {
                            handleAnimationEnd(thing.id);
                          }
                        }}
                      >
                        <InboxItemRow
                          thing={thing}
                          isFocused={!addInputFocused && activeIdx === focusedIndex}
                          isSelected={selectedIds.has(thing.id)}
                          isAnimatingOut={isOut}
                          isNew={isNewItem}
                          selectedIds={selectedIds}
                          hideSource={allSameSource}
                          relativeAge={
                            thing.createdAt
                              ? computeRelativeAge(new Date(thing.createdAt), now.current)
                              : ""
                          }
                          onClick={() => onItemClick(thing)}
                          onFocus={() => {
                            if (activeIdx >= 0) setFocusedIndex(activeIdx);
                          }}
                          onToggle={(id) => {
                            pendingToggles.current.add(id);
                            if (toggleTimer.current) clearTimeout(toggleTimer.current);
                            toggleTimer.current = setTimeout(() => {
                              const ids = [...pendingToggles.current];
                              pendingToggles.current = new Set();
                              slideOut(ids);
                              ids.forEach(toggleId => onToggle(toggleId));
                            }, 600);
                          }}
                          onSelect={() => {
                            setSelectedIds((prev) => {
                              const next = new Set(prev);
                              if (next.has(thing.id)) {
                                next.delete(thing.id);
                              } else {
                                next.add(thing.id);
                              }
                              return next;
                            });
                          }}
                          onReconnect={thing.sourceId?.startsWith("relink:") && onReconnect
                            ? () => onReconnect(thing.sourceId!)
                            : undefined}
                          reconnectPending={thing.sourceId === reconnectPendingSourceId}
                          onInstallUpdate={thing.sourceId === "system:update" ? onInstallUpdate : undefined}
                        />
                      </div>
                    );
                  })}
                </React.Fragment>
              );
            })}
          </div>
        )}

    </ItemListShell>
  );
}
