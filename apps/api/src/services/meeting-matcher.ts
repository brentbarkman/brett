const TIME_TOLERANCE_MS = 3 * 60 * 60 * 1000; // 3 hours — Granola reports actual start time which can differ from calendar scheduled time
const CONFIDENCE_THRESHOLD = 0.5;
const TITLE_WEIGHT = 0.6;
const ATTENDEE_WEIGHT = 0.4;
// Tight window used when we have no attendee signal to lean on — a "Team
// Sync" Granola note landing in the same day as a different "Team Sync"
// calendar event shouldn't match unless the times line up much more closely
// than the generous TIME_TOLERANCE_MS allows.
const NO_ATTENDEE_TIME_TOLERANCE_MS = 30 * 60 * 1000; // 30 min

export interface MatchCandidate {
  id: string;
  title: string;
  startTime: Date;
  endTime: Date;
  attendees: { email: string }[];
}

interface MeetingInput {
  title: string;
  startTime: Date;
  endTime: Date;
  attendees: { email: string }[];
}

export interface MatchResult {
  id: string;
  score: number;
}

/**
 * Find the best CalendarEvent match for a Granola meeting.
 * Returns null if no candidate passes the confidence threshold.
 */
export function findBestMatch(
  meeting: MeetingInput,
  candidates: MatchCandidate[],
): MatchResult | null {
  let bestMatch: MatchResult | null = null;

  for (const candidate of candidates) {
    const titleScore = titleSimilarity(meeting.title, candidate.title);

    // Exact title + same day = match regardless of time gap
    // (Granola's reported times can differ significantly from calendar)
    const sameDay = meeting.startTime.toISOString().slice(0, 10) ===
      candidate.startTime.toISOString().slice(0, 10);
    const exactTitle = titleScore > 0.95;

    if (!exactTitle && !hasTimeOverlap(meeting, candidate)) continue;
    if (!sameDay && !hasTimeOverlap(meeting, candidate)) continue;

    const attendeeScore = attendeeOverlap(
      meeting.attendees,
      candidate.attendees,
    );
    const score = titleScore * TITLE_WEIGHT + attendeeScore * ATTENDEE_WEIGHT;

    // When BOTH sides have zero attendees (common for 1:1 calls and
    // scratch Granola notes), require a tight time overlap. Otherwise
    // two generic "Team Sync" events on the same day would match each
    // other on title alone and pollute both with wrong notes.
    //
    // If even one side has attendees, attendeeScore carries some signal
    // (even when it's 0) — the 0.5 CONFIDENCE_THRESHOLD check below is
    // the primary filter for weak matches there.
    const bothMissingAttendees =
      meeting.attendees.length === 0 && candidate.attendees.length === 0;
    if (bothMissingAttendees && !hasTightTimeOverlap(meeting, candidate)) continue;

    if (score >= CONFIDENCE_THRESHOLD && (!bestMatch || score > bestMatch.score)) {
      bestMatch = { id: candidate.id, score };
    }
  }

  return bestMatch;
}

function hasTimeOverlap(a: MeetingInput, b: MatchCandidate): boolean {
  const aStart = a.startTime.getTime() - TIME_TOLERANCE_MS;
  const aEnd = a.endTime.getTime() + TIME_TOLERANCE_MS;
  const bStart = b.startTime.getTime();
  const bEnd = b.endTime.getTime();

  return aStart < bEnd && bStart < aEnd;
}

function hasTightTimeOverlap(a: MeetingInput, b: MatchCandidate): boolean {
  const aStart = a.startTime.getTime() - NO_ATTENDEE_TIME_TOLERANCE_MS;
  const aEnd = a.endTime.getTime() + NO_ATTENDEE_TIME_TOLERANCE_MS;
  const bStart = b.startTime.getTime();
  const bEnd = b.endTime.getTime();

  return aStart < bEnd && bStart < aEnd;
}

/**
 * Normalized title similarity using bigram overlap (Dice coefficient).
 * Case-insensitive, handles empty strings.
 */
function titleSimilarity(a: string, b: string): number {
  const aNorm = a.toLowerCase().trim();
  const bNorm = b.toLowerCase().trim();

  if (aNorm === bNorm) return 1;
  if (aNorm.length < 2 || bNorm.length < 2) return 0;

  const aBigrams = bigrams(aNorm);
  const bBigrams = bigrams(bNorm);

  let overlap = 0;
  const bCopy = [...bBigrams];
  for (const bg of aBigrams) {
    const idx = bCopy.indexOf(bg);
    if (idx !== -1) {
      overlap++;
      bCopy.splice(idx, 1);
    }
  }

  return (2 * overlap) / (aBigrams.length + bBigrams.length);
}

function bigrams(s: string): string[] {
  const result: string[] = [];
  for (let i = 0; i < s.length - 1; i++) {
    result.push(s.slice(i, i + 2));
  }
  return result;
}

/**
 * Ratio of shared attendee emails.
 * Returns 0 if either list is empty (no signal, don't penalize).
 */
function attendeeOverlap(
  a: { email: string }[],
  b: { email: string }[],
): number {
  if (a.length === 0 || b.length === 0) return 0;

  const aEmails = new Set(a.map((x) => x.email.toLowerCase()));
  const bEmails = new Set(b.map((x) => x.email.toLowerCase()));

  let shared = 0;
  for (const email of aEmails) {
    if (bEmails.has(email)) shared++;
  }

  const union = new Set([...aEmails, ...bEmails]).size;
  return union > 0 ? shared / union : 0;
}
