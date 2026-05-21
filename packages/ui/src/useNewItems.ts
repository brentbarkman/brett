import { useEffect, useRef } from "react";

/**
 * Returns the subset of item IDs that are new since the previous render —
 * useful for one-shot enter animations (CSS keyframe on first paint after
 * the item lands).
 *
 * - Empty Set on the initial load so the entire list doesn't fade in at once.
 * - Once an ID has been seen, it's never re-flagged as new, even if the
 *   array reference changes for other reasons.
 */
export function useNewItems<T extends { id: string }>(items: T[]): Set<string> {
  const isInitialLoadRef = useRef(true);
  const prevIdsRef = useRef<Set<string>>(new Set());

  const newIds = (() => {
    if (isInitialLoadRef.current) return new Set<string>();
    const ids = new Set<string>();
    for (const t of items) {
      if (!prevIdsRef.current.has(t.id)) ids.add(t.id);
    }
    return ids;
  })();

  useEffect(() => {
    if (items.length > 0) {
      isInitialLoadRef.current = false;
    }
    prevIdsRef.current = new Set(items.map((t) => t.id));
  }, [items]);

  return newIds;
}
