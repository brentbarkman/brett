// Today badge count — kept narrow on purpose: overdue + today only.
//
// History: before 2026-05-18 the badge also included "this_week" items (and,
// on weekends, "this_weekend" items). That made the badge noisy during the
// workweek and conflated "things to do today" with "things due eventually
// this week". Spec: docs/superpowers/specs/2026-05-18-brett-tuning-may-design.md.
//
// Tonight items are counted as today — they have `dueDate = today end`, so the
// same `dueDate <= endOfToday` predicate captures them. The `tonight` flag
// only affects sectioning, not counting.
//
// iOS parity lives in apps/ios/Brett/Views/Today/TodaySections.swift's
// `badgeCount` static method — they must move in lockstep.

type BadgeInputThing = {
  dueDate?: string | Date | null;
  isCompleted?: boolean;
};

export function computeBadgeCount(
  things: BadgeInputThing[],
  now: Date = new Date(),
): number {
  const endOfToday = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      23,
      59,
      59,
      999,
    ),
  );
  return things.filter((t) => {
    if (t.isCompleted) return false;
    if (!t.dueDate) return false;
    return new Date(t.dueDate) <= endOfToday;
  }).length;
}
