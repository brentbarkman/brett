import React, { useState, useRef, useCallback, useEffect } from "react";
import { Plus, Check, ChevronDown, ChevronRight } from "lucide-react";
import type { Thing, NavList } from "@brett/types";
import { computeRelativeAge } from "@brett/business";
import { InboxItemRow } from "./InboxItemRow";

interface InboxViewProps {
  things: Thing[];
  hiddenCount: number;
  hiddenThings?: Thing[];
  lists: NavList[];
  onItemClick: (thing: Thing) => void;
  onToggle: (id: string) => void;
  onArchive: (ids: string[]) => void;
  onAdd: (title: string) => void;
  onTriage: (
    ids: string[],
    updates: { listId?: string | null; dueDate?: string | null }
  ) => void;
  /** Render prop for triage popup — InboxView passes trigger info, parent renders popup */
  triagePopup?: React.ReactNode;
  onTriageOpen?: (mode: "list-first" | "date-first", ids: string[]) => void;
}

export function InboxView({
  things,
  hiddenCount,
  hiddenThings,
  lists,
  onItemClick,
  onToggle,
  onArchive,
  onAdd,
  onTriage,
  triagePopup,
  onTriageOpen,
}: InboxViewProps) {
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [animatingOutIds, setAnimatingOutIds] = useState<Set<string>>(
    new Set()
  );
  const [showHidden, setShowHidden] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const quickAddRef = useRef<HTMLInputElement>(null);
  const [quickAddValue, setQuickAddValue] = useState("");
  const [quickAddFocused, setQuickAddFocused] = useState(false);
  const now = useRef(new Date());

  // Update "now" every minute for relative age
  useEffect(() => {
    const interval = setInterval(() => {
      now.current = new Date();
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  // Visible items (excluding animating out)
  const visibleThings = things.filter((t) => !animatingOutIds.has(t.id));

  // Clamp focus index
  useEffect(() => {
    if (focusedIndex >= visibleThings.length && visibleThings.length > 0) {
      setFocusedIndex(visibleThings.length - 1);
    }
  }, [visibleThings.length, focusedIndex]);

  const focusedThing = visibleThings[focusedIndex];

  const getTargetIds = useCallback((): string[] => {
    if (selectedIds.size > 0) return [...selectedIds];
    if (focusedThing) return [focusedThing.id];
    return [];
  }, [selectedIds, focusedThing]);

  const slideOut = useCallback(
    (ids: string[]) => {
      setAnimatingOutIds((prev) => {
        const next = new Set(prev);
        ids.forEach((id) => next.add(id));
        return next;
      });
    },
    []
  );

  const handleAnimationEnd = useCallback(
    (id: string) => {
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

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
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
          // Extend selection
          if (focusedThing) {
            setSelectedIds((prev) => {
              const next = new Set(prev);
              next.add(focusedThing.id);
              return next;
            });
          }
          setFocusedIndex((i) => Math.min(i + 1, visibleThings.length - 1));
          const nextThing = visibleThings[Math.min(focusedIndex + 1, visibleThings.length - 1)];
          if (nextThing) {
            setSelectedIds((prev) => {
              const next = new Set(prev);
              next.add(nextThing.id);
              return next;
            });
          }
        } else {
          setFocusedIndex((i) => Math.min(i + 1, visibleThings.length - 1));
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
          const prevThing = visibleThings[Math.max(focusedIndex - 1, 0)];
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
        setSelectedIds(new Set(visibleThings.map((t) => t.id)));
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

      // Escape — deselect
      if (key === "Escape") {
        e.preventDefault();
        setSelectedIds(new Set());
        return;
      }

      // Triage: list-first
      if (key === "l") {
        e.preventDefault();
        const ids = getTargetIds();
        if (ids.length === 0) return;
        onTriageOpen?.("list-first", ids);
        return;
      }

      // Triage: date-first
      if (key === "d") {
        e.preventDefault();
        const ids = getTargetIds();
        if (ids.length === 0) return;
        onTriageOpen?.("date-first", ids);
        return;
      }
    },
    [
      focusedIndex,
      focusedThing,
      visibleThings,
      getTargetIds,
      slideOut,
      onToggle,
      onArchive,
      onItemClick,
      onTriageOpen,
    ]
  );

  const handleQuickAddSubmit = () => {
    if (!quickAddValue.trim()) return;
    onAdd(quickAddValue.trim());
    setQuickAddValue("");
    quickAddRef.current?.focus();
  };

  const handleQuickAddKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleQuickAddSubmit();
    }
    if (e.key === "Escape") {
      setQuickAddValue("");
      quickAddRef.current?.blur();
      containerRef.current?.focus();
    }
  };

  const isEmpty = visibleThings.length === 0 && hiddenCount === 0;

  return (
    <div className="flex flex-col gap-4 pb-20">
      <div
        ref={containerRef}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        className="bg-black/30 backdrop-blur-xl rounded-xl border border-white/10 p-4 outline-none"
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-bold text-white">Inbox</h2>
            {visibleThings.length > 0 && (
              <span className="text-sm text-white/40">
                {visibleThings.length} item{visibleThings.length !== 1 ? "s" : ""}
              </span>
            )}
          </div>
          <span className="text-[10px] text-white/25 font-mono">
            n to add
          </span>
        </div>

        {/* Quick-add input */}
        <div
          className={`
            flex items-center gap-2.5 px-3 py-2 rounded-lg transition-all mb-3
            ${quickAddFocused
              ? "bg-white/5 border border-blue-500/20"
              : "border border-transparent hover:bg-white/[0.03]"
            }
          `}
        >
          <Plus
            size={15}
            className={quickAddFocused ? "text-blue-400" : "text-white/20"}
          />
          <input
            ref={quickAddRef}
            type="text"
            placeholder="Add to inbox..."
            value={quickAddValue}
            onChange={(e) => setQuickAddValue(e.target.value)}
            onKeyDown={handleQuickAddKeyDown}
            onFocus={() => setQuickAddFocused(true)}
            onBlur={() => {
              if (!quickAddValue) setQuickAddFocused(false);
            }}
            className="flex-1 bg-transparent border-none outline-none text-white placeholder:text-white/20 text-sm"
          />
          {quickAddFocused && quickAddValue.trim() && (
            <span className="text-[10px] text-white/25 font-mono">enter</span>
          )}
        </div>

        {/* Empty state */}
        {isEmpty && (
          <div className="flex flex-col items-center justify-center py-12 gap-3">
            <div className="w-12 h-12 rounded-full bg-green-500/10 border border-green-500/20 flex items-center justify-center">
              <Check size={24} className="text-green-400" />
            </div>
            <p className="text-sm text-white/60 font-medium">
              You're all caught up
            </p>
          </div>
        )}

        {/* Item list */}
        {visibleThings.length > 0 && (
          <div className="flex flex-col gap-0.5">
            {visibleThings.map((thing, index) => (
              <InboxItemRow
                key={thing.id}
                thing={thing}
                isFocused={index === focusedIndex}
                isSelected={selectedIds.has(thing.id)}
                isAnimatingOut={animatingOutIds.has(thing.id)}
                selectedIds={selectedIds}
                relativeAge={
                  thing.createdAt
                    ? computeRelativeAge(new Date(thing.createdAt), now.current)
                    : ""
                }
                onClick={() => onItemClick(thing)}
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
                onAnimationEnd={() => handleAnimationEnd(thing.id)}
              />
            ))}
          </div>
        )}

        {/* Hidden section */}
        {hiddenCount > 0 && (
          <div className="mt-3 pt-3 border-t border-white/5">
            <button
              onClick={() => setShowHidden(!showHidden)}
              className="flex items-center gap-2 text-xs text-white/40 hover:text-white/60 transition-colors"
            >
              {showHidden ? (
                <ChevronDown size={14} />
              ) : (
                <ChevronRight size={14} />
              )}
              <span>
                {hiddenCount} item{hiddenCount !== 1 ? "s" : ""} with future
                dates
              </span>
            </button>
            {showHidden && hiddenThings && (
              <div className="flex flex-col gap-0.5 mt-2 opacity-60">
                {hiddenThings.map((thing) => (
                  <InboxItemRow
                    key={thing.id}
                    thing={thing}
                    isFocused={false}
                    isSelected={false}
                    isAnimatingOut={false}
                    relativeAge={thing.dueDateLabel ?? ""}
                    selectedIds={selectedIds}
                    onClick={() => onItemClick(thing)}
                    onSelect={() => {}}
                    onAnimationEnd={() => {}}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Triage popup (rendered by parent) */}
        {triagePopup}
      </div>

      {/* Keyboard hint bar */}
      {visibleThings.length > 0 && (
        <div className="flex items-center justify-center gap-4 text-[10px] text-white/20 font-mono">
          <span>j/k navigate</span>
          <span>x select</span>
          <span>l list</span>
          <span>d date</span>
          <span>e done</span>
          <span># archive</span>
        </div>
      )}

      <style>{`
        @keyframes inboxSlideOut {
          to {
            transform: translateX(-100%);
            opacity: 0;
          }
        }
        @keyframes inboxItemEnter {
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
