import type { RsvpInput, CalendarEventNoteInput, CalendarEventRecord } from "@brett/types";

const VALID_RSVP_STATUSES = ["accepted", "declined", "tentative", "needsAction"];
const MAX_COMMENT_LENGTH = 500;
const MAX_NOTE_SIZE = 50 * 1024;

type ValidationResult<T> = { ok: true; data: T } | { ok: false; error: string };

export function validateRsvpInput(input: RsvpInput): ValidationResult<RsvpInput> {
  if (!input.status || !VALID_RSVP_STATUSES.includes(input.status)) {
    return { ok: false, error: `Invalid status: must be one of ${VALID_RSVP_STATUSES.join(", ")}` };
  }
  if (input.comment !== undefined && input.comment.length > MAX_COMMENT_LENGTH) {
    return { ok: false, error: `comment must be ${MAX_COMMENT_LENGTH} characters or fewer` };
  }
  return { ok: true, data: input };
}

export function validateCalendarNoteInput(input: CalendarEventNoteInput): ValidationResult<CalendarEventNoteInput> {
  if (!input.content || input.content.length === 0) {
    return { ok: false, error: "content is required" };
  }
  if (input.content.length > MAX_NOTE_SIZE) {
    return { ok: false, error: `content must be ${MAX_NOTE_SIZE} bytes or fewer` };
  }
  return { ok: true, data: input };
}

/**
 * Whether an event should be hidden from a timeline because the user
 * declined it.
 *
 * Mirrors Google Calendar's "Hide declined events" default: events the
 * user explicitly declined are hidden, but events the user organized
 * stay visible regardless of declined status. Declining your own event
 * is unusual — most users still want to see it on their calendar (e.g.
 * because they're hosting it for others, or as a placeholder they
 * might re-accept later).
 *
 * Pass any object that exposes `myResponseStatus` and `organizer.self`
 * — both `CalendarEventRecord` and `CalendarEventDisplay`-shaped values
 * fit. Returns `true` when the timeline should hide the event.
 */
export function isHiddenDeclined(
  event: Pick<CalendarEventRecord, "myResponseStatus" | "organizer">
): boolean {
  if (event.myResponseStatus !== "declined") return false;
  return event.organizer?.self !== true;
}
