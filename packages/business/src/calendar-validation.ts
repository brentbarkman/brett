import type { RsvpInput, CalendarEventNoteInput } from "@brett/types";

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
