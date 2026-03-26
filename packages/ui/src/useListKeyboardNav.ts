import { useState, useEffect, useCallback } from "react";
import type { Thing } from "@brett/types";

interface UseListKeyboardNavOptions {
  items: Thing[];
  onItemClick: (thing: Thing) => void;
  onToggle?: (id: string) => void;
  onFocusAdd?: () => void;
  /** Called when the focused item changes via keyboard navigation */
  onFocusChange?: (thing: Thing) => void;
  /** Extra keyboard handler for view-specific shortcuts (return true if handled) */
  onExtraKey?: (e: KeyboardEvent, focusedThing: Thing | null, focusedIndex: number) => boolean;
}

export function useListKeyboardNav({
  items,
  onItemClick,
  onToggle,
  onFocusAdd,
  onFocusChange,
  onExtraKey,
}: UseListKeyboardNavOptions) {
  const [focusedIndex, setFocusedIndex] = useState(0);
  const focusedThing = items[focusedIndex] ?? null;

  // Clamp focus when list changes
  useEffect(() => {
    setFocusedIndex((i) => Math.min(i, Math.max(items.length - 1, 0)));
  }, [items.length]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Don't intercept when input, textarea, contenteditable, or omnibar/modal is focused
      const el = document.activeElement;
      if (
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        (el instanceof HTMLElement && el.isContentEditable) ||
        (el instanceof HTMLElement && el.closest("[data-omnibar]"))
      ) {
        return;
      }

      // Don't intercept when any modal/overlay is open (spotlight, dialogs)
      if (document.querySelector("[data-spotlight-modal]")) {
        return;
      }

      // Let view-specific handler try first
      if (onExtraKey?.(e, focusedThing, focusedIndex)) return;

      const key = e.key;

      if (key === "ArrowDown" || key === "j") {
        e.preventDefault();
        setFocusedIndex((i) => {
          const next = Math.min(i + 1, items.length - 1);
          if (next !== i && items[next] && onFocusChange) onFocusChange(items[next]);
          return next;
        });
        return;
      }

      if (key === "ArrowUp" || key === "k") {
        e.preventDefault();
        setFocusedIndex((i) => {
          const next = Math.max(i - 1, 0);
          if (next !== i && items[next] && onFocusChange) onFocusChange(items[next]);
          return next;
        });
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

      if (key === "n") {
        e.preventDefault();
        onFocusAdd?.();
        return;
      }
    },
    [focusedIndex, focusedThing, items, onItemClick, onToggle, onFocusAdd, onExtraKey]
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  const [addInputFocused, setAddInputFocused] = useState(false);

  // When add input is focused, return -1 so no item appears highlighted
  const effectiveIndex = addInputFocused ? -1 : focusedIndex;

  return { focusedIndex: effectiveIndex, setFocusedIndex, focusedThing, setAddInputFocused };
}
