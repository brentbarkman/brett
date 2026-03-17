import { useEffect, type RefObject } from "react";

/**
 * Calls `callback` when a click occurs outside the given ref(s).
 * Only active when `enabled` is true (default).
 */
export function useClickOutside(
  refs: RefObject<HTMLElement | null> | RefObject<HTMLElement | null>[],
  callback: () => void,
  enabled = true,
) {
  useEffect(() => {
    if (!enabled) return;
    const refArray = Array.isArray(refs) ? refs : [refs];
    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      const isInside = refArray.some((ref) => ref.current?.contains(target));
      if (!isInside) callback();
    };
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [refs, callback, enabled]);
}
