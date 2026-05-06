import type { Prisma } from "@brett/api-core";

/**
 * Where-clause fragment selecting only events on user-visible calendars.
 *
 * Shared between the REST `/calendar/events` endpoint (used by desktop)
 * and the `/sync/pull` calendar_events branch (used by iOS) so the two
 * clients agree on which events are user-visible. Without sharing the
 * filter, iOS sync-pulls everything the user owns and silently shows
 * events from calendars desktop has hidden via `CalendarList.isVisible`.
 */
export const eventsOnVisibleCalendars: Prisma.CalendarEventWhereInput = {
  calendarList: { isVisible: true },
};
