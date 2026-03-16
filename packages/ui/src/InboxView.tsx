import React, { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { Inbox } from "lucide-react";
import type { Thing, NavList } from "@brett/types";
import { computeRelativeAge } from "@brett/business";
import { InboxItemRow } from "./InboxItemRow";
import { QuickAddInput, type QuickAddInputHandle } from "./QuickAddInput";
import { ItemListShell } from "./ItemListShell";

interface InboxViewProps {
  things: Thing[];
  lists: NavList[];
  onItemClick: (thing: Thing) => void;
  onToggle: (id: string) => void;
  onArchive: (ids: string[]) => void;
  onAdd: (title: string) => void;
  onTriage: (
    ids: string[],
    updates: { listId?: string | null; dueDate?: string | null; dueDatePrecision?: "day" | "week" | null }
  ) => void;
  onTriageOpen?: (mode: "list-first" | "date-first", ids: string[], thing?: { listId?: string | null; dueDate?: string; dueDatePrecision?: "day" | "week" | null }) => void;
}

export function InboxView({
  things,
  lists,
  onItemClick,
  onToggle,
  onArchive,
  onAdd,
  onTriage,
  onTriageOpen,
}: InboxViewProps) {
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [animatingOutIds, setAnimatingOutIds] = useState<Set<string>>(
    new Set()
  );
  const [addInputFocused, setAddInputFocused] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const quickAddRef = useRef<QuickAddInputHandle>(null);
  const now = useRef(new Date());

  // Snapshots of items being animated out (persist through refetches)
  const animatingOutItemsRef = useRef<Map<string, Thing>>(new Map());

  // Track previous thing IDs for enter animation
  const isInitialLoadRef = useRef(true);
  const prevThingIdsRef = useRef<Set<string>>(new Set());

  // Update "now" every minute for relative age
  useEffect(() => {
    const interval = setInterval(() => {
      now.current = new Date();
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  // Build display list: current things + snapshotted animating-out items removed by refetch
  const displayThings = useMemo(() => {
    const currentIds = new Set(things.map((t) => t.id));
    const result = [...things];
    for (const [id, item] of animatingOutItemsRef.current) {
      if (!currentIds.has(id)) {
        result.push(item);
      }
    }
    return result;
  }, [things]);

  // Active items (for focus/selection) — excludes animating out
  const activeThings = useMemo(
    () => displayThings.filter((t) => !animatingOutIds.has(t.id)),
    [displayThings, animatingOutIds]
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
    [things]
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
          setFocusedIndex((i) => Math.min(i + 1, activeThings.length - 1));
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
          setFocusedIndex((i) => Math.max(i - 1, 0));
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

  const isEmpty = displayThings.length === 0;

  const inboxHeader = (
    <>
      <div className="flex items-center gap-3">
        <Inbox size={20} className="text-white/50" />
        <h2 className="text-xl font-bold text-white">Inbox</h2>
      </div>
    </>
  );

  const inboxHints = activeThings.length > 0
    ? ["esc shortcuts", "j/k navigate", "x select", "l list", "d date", "e done", "# archive"]
    : [];

  return (
    <ItemListShell header={inboxHeader} hints={inboxHints}>
        <QuickAddInput ref={quickAddRef} placeholder="Add to inbox..." onAdd={onAdd} onFocusChange={setAddInputFocused} />

        {/* Empty state */}
        {isEmpty && (
          <div className="flex flex-col items-center justify-center py-12 gap-2">
            <p className="text-sm text-white/40">Nothing here yet</p>
            <p className="text-xs text-white/20 font-mono">
              press <kbd className="px-1 py-0.5 rounded bg-white/5 text-white/30">n</kbd> to add
            </p>
          </div>
        )}

        {/* Item list */}
        {displayThings.length > 0 && (
          <div className="flex flex-col">
            {displayThings.map((thing) => {
              const isOut = animatingOutIds.has(thing.id);
              const isNew = newItemIds.has(thing.id);
              const activeIdx = activeIndexMap.get(thing.id) ?? -1;

              return (
                <div
                  key={thing.id}
                  className="inbox-item-wrapper"
                  style={{
                    overflow: "hidden",
                    maxHeight: isOut ? 0 : 56,
                    marginBottom: isOut ? 0 : 2,
                    transition: isOut
                      ? "max-height 200ms ease-out 120ms, margin-bottom 200ms ease-out 120ms"
                      : "none",
                    animation: isNew
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
                    isNew={isNew}
                    selectedIds={selectedIds}
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
                      slideOut([id]);
                      onToggle(id);
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
                  />
                </div>
              );
            })}
          </div>
        )}

      <style>{`
        @keyframes inboxSlideOut {
          from {
            transform: translateX(0);
            opacity: 1;
          }
          to {
            transform: translateX(-24px);
            opacity: 0;
          }
        }
        @keyframes inboxItemExpand {
          from {
            max-height: 0;
            opacity: 0;
            margin-bottom: 0;
          }
          to {
            max-height: 56px;
            opacity: 1;
            margin-bottom: 2px;
          }
        }
      `}</style>
    </ItemListShell>
  );
}
