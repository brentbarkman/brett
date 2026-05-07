import type { Prisma } from "@brett/api-core";

/**
 * Where-clause fragment selecting events the user should see live —
 * shared between the REST `/calendar/events` endpoint (used by desktop)
 * and the `/sync/pull` calendar_events branch (used by iOS) so the
 * two clients always agree on what counts as "visible".
 *
 * The invariant we're enforcing: the set of LIVE events returned by
 * `/sync/pull` equals the set of events returned by `/calendar/events`.
 * Tombstones in `/sync/pull` are extra (they signal removals that
 * `/calendar/events` represents implicitly by re-querying).
 *
 * Each rule must apply to BOTH endpoints — adding one here without
 * threading it through both call sites silently re-creates the iOS↔
 * desktop drift this helper exists to prevent.
 *
 * Current rules:
 *  • `calendarList.isVisible: true` — respects the per-calendar
 *    visibility toggle. Toggling off cascades a soft-delete
 *    (PATCH /calendar/accounts/.../calendars/...) so existing iOS
 *    replicas of those events get a tombstone via /sync/pull.
 *  • `status: { not: "cancelled" }` — Google-cancelled events should
 *    never render. The cancellation handler in calendar-sync.ts
 *    soft-deletes them (deletedAt + status="cancelled") so iOS
 *    receives a tombstone; the live filter here is defense-in-depth
 *    in case a race ever leaves a cancelled-but-live row.
 *
 * IMPORTANT: in `/sync/pull`, this filter must be passed via
 * `extraWhereLive`, NOT `extraWhere`. Constraining the tombstone
 * query by these flags would block exactly the delete signal we
 * need to send (a soft-deleted hidden-calendar event would be
 * filtered out of the tombstone stream by its own now-false
 * `isVisible` join). See `paginated-pull.ts`.
 */
export const liveCalendarEventFilter: Prisma.CalendarEventWhereInput = {
  calendarList: { isVisible: true },
  status: { not: "cancelled" },
};
