import type { MeetingTranscriptTurn, MeetingNoteAttendee } from "@brett/types";

/** Summary priority: granola > google_meet (Granola produces richer AI summaries) */
const SUMMARY_PRIORITY: Record<string, number> = { granola: 10, google_meet: 5 };

export interface MergeInput {
  title: string | null;
  summary: string | null;
  transcript: MeetingTranscriptTurn[] | null;
  attendees: MeetingNoteAttendee[] | null;
  sources: string[];
}

export interface SourceInput {
  provider: string;
  title: string;
  summary: string | null;
  transcript: MeetingTranscriptTurn[] | null;
  attendees: MeetingNoteAttendee[] | null;
}

export interface MergeResult {
  title: string;
  summary: string | null;
  transcript: MeetingTranscriptTurn[] | null;
  attendees: MeetingNoteAttendee[] | null;
  sources: string[];
}

export function mergeMeetingNoteFields(existing: MergeInput, source: SourceInput): MergeResult {
  const title = existing.title ?? source.title;

  // Summary: prefer higher-priority provider
  let summary = existing.summary;
  if (source.summary) {
    if (!existing.summary) {
      summary = source.summary;
    } else {
      const existingPriority = existing.sources.length > 0
        ? Math.max(...existing.sources.map((s) => SUMMARY_PRIORITY[s] ?? 0))
        : 0;
      const sourcePriority = SUMMARY_PRIORITY[source.provider] ?? 0;
      if (sourcePriority > existingPriority) {
        summary = source.summary;
      }
    }
  }

  // Transcript: prefer longer (more speaker turns = richer)
  let transcript = existing.transcript;
  if (source.transcript && source.transcript.length > 0) {
    if (!existing.transcript || source.transcript.length > existing.transcript.length) {
      transcript = source.transcript;
    }
  }

  // Attendees: union by email (case-insensitive)
  const attendees = mergeAttendees(existing.attendees, source.attendees);

  // Sources: append if new
  const sources = existing.sources.includes(source.provider)
    ? existing.sources
    : [...existing.sources, source.provider];

  return { title, summary, transcript, attendees, sources };
}

function mergeAttendees(
  existing: MeetingNoteAttendee[] | null,
  incoming: MeetingNoteAttendee[] | null,
): MeetingNoteAttendee[] | null {
  if (!existing && !incoming) return null;
  if (!existing) return incoming;
  if (!incoming) return existing;

  const seen = new Map<string, MeetingNoteAttendee>();
  for (const a of existing) seen.set(a.email.toLowerCase(), a);
  for (const a of incoming) {
    if (!seen.has(a.email.toLowerCase())) seen.set(a.email.toLowerCase(), a);
  }
  return Array.from(seen.values());
}
