const TIME_TOLERANCE_MS = 3 * 60 * 60 * 1000; // 3 hours — Granola reports actual start time which can differ from calendar scheduled time
const CONFIDENCE_THRESHOLD = 0.5;
const TITLE_WEIGHT = 0.6;
const ATTENDEE_WEIGHT = 0.4;

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
    if (!hasTimeOverlap(meeting, candidate)) continue;

    const titleScore = titleSimilarity(meeting.title, candidate.title);
    const attendeeScore = attendeeOverlap(
      meeting.attendees,
      candidate.attendees,
    );
    const score = titleScore * TITLE_WEIGHT + attendeeScore * ATTENDEE_WEIGHT;

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
