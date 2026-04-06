import type { CalendarEvent } from "@prisma/client";
import type { MeetingTranscriptTurn, MeetingNoteAttendee } from "@brett/types";

export interface MeetingNoteProvider {
  readonly provider: string;

  fetchForEvent(
    userId: string,
    calendarEvent: CalendarEvent,
  ): Promise<ProviderMeetingData | null>;

  fetchRecent(
    userId: string,
    since: Date,
    until: Date,
  ): Promise<ProviderMeetingData[]>;

  isAvailable(userId: string): Promise<boolean>;
}

export interface ProviderMeetingData {
  provider: string;
  externalId: string;
  accountId: string;
  calendarEventId?: string;
  title: string;
  summary: string | null;
  transcript: MeetingTranscriptTurn[] | null;
  attendees: MeetingNoteAttendee[] | null;
  meetingStartedAt: Date;
  meetingEndedAt: Date;
  rawData: unknown;
}
