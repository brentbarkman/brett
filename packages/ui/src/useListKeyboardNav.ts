import { useState, useEffect, useRef } from "react";
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

  // Pin every caller-provided dependency of the keyboard handler on a ref
  // so the handler's identity doesn't change when parents pass inline
  // arrow functions / fresh arrays every render. Prior code used
  // `[handleKeyDown]` as the effect dep list, which re-ran add/remove on
  // every parent render — fine for correctness but expensive when a parent
  // re-renders on every stream token.
  const handlerStateRef = useRef({
    items,
    focusedIndex,
    focusedThing,
    onItemClick,
    onToggle,
    onFocusAdd,
    onFocusChange,
    onExtraKey,
  });
  handlerStateRef.current = {
    items,
    focusedIndex,
    focusedThing,
    onItemClick,
    onToggle,
    onFocusAdd,
    onFocusChange,
    onExtraKey,
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    // Read everything through the ref so this closure is stable across
    // renders but always sees the latest values.
    const {
      items,
      focusedIndex,
      focusedThing,
      onItemClick,
      onToggle,
      onFocusAdd,
      onFocusChange,
      onExtraKey,
    } = handlerStateRef.current;
      // Don't intercept when input, textarea, or contenteditable is focused
      const el = document.activeElement;
      if (
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        (el instanceof HTMLElement && el.isContentEditable)
      ) {
        return;
      }

      // Don't intercept when omnibar or spotlight is open
      // These use document-level event listeners that conflict with ours
      if (
        document.querySelector("[data-omnibar-open]") ||
        document.querySelector("[data-spotlight-modal]")
      ) {
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
  };

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [addInputFocused, setAddInputFocused] = useState(false);

  // When add input is focused, return -1 so no item appears highlighted
  const effectiveIndex = addInputFocused ? -1 : focusedIndex;

  return { focusedIndex: effectiveIndex, setFocusedIndex, focusedThing, setAddInputFocused };
}
