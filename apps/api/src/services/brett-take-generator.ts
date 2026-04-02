const MIN_DESCRIPTION_LENGTH = 50;

interface EventForQualification {
  id: string;
  description: string | null;
  recurringEventId: string | null;
  brettObservation: string | null;
  brettObservationAt: Date | null;
  updatedAt: Date;
}

/**
 * Does this event have enough context to merit a Brett's Take?
 * @param hasPriorTranscript - whether a prior occurrence has a MeetingNote transcript
 */
export function qualifiesForTake(
  event: EventForQualification,
  hasPriorTranscript: boolean,
): boolean {
  if (event.description && event.description.length > MIN_DESCRIPTION_LENGTH) {
    return true;
  }
  if (event.recurringEventId && hasPriorTranscript) {
    return true;
  }
  return false;
}

/**
 * Does this event need (re)generation of its Take?
 */
export function needsGeneration(event: EventForQualification): boolean {
  if (!event.brettObservation) return true;
  if (!event.brettObservationAt) return true;
  return event.brettObservationAt < event.updatedAt;
}
