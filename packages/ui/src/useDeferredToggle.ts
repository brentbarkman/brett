import { useRef, useEffect } from "react";

/**
 * Collapse a burst of toggle clicks on a list of items into one batch of
 * mutations after the user stops clicking. Prevents each item from
 * shuffling out of the list on every tap, which breaks rapid-fire
 * selection.
 *
 * Usage (identical to the hand-rolled version previously inline in
 * `ThingsList` / `InboxView`):
 *
 *   const handleToggle = useDeferredToggle(onToggle);
 *   <Row onToggle={handleToggle} />
 *
 * All three list views (ThingsList, InboxView, UpcomingView) must use
 * this — CLAUDE.md's list-consistency rule requires the same toggle
 * behavior across every list surface.
 */
export function useDeferredToggle(
  onToggle?: (id: string) => void,
  delayMs = 600,
): (id: string) => void {
  const pending = useRef<Set<string>>(new Set());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  return (id: string) => {
    pending.current.add(id);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const ids = [...pending.current];
      pending.current = new Set();
      ids.forEach((toggleId) => onToggle?.(toggleId));
    }, delayMs);
  };
}
