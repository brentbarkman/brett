// ── Granola types ──

export interface GranolaAccountRecord {
  id: string;
  email: string;
  lastSyncAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GranolaAccountStatus {
  connected: boolean;
  account: GranolaAccountRecord | null;
}

export interface GranolaMeetingRecord {
  id: string;
  granolaDocumentId: string;
  calendarEventId: string | null;
  title: string;
  summary: string | null;
  attendees: GranolaMeetingAttendee[] | null;
  actionItems: GranolaActionItem[] | null;
  meetingStartedAt: string;
  meetingEndedAt: string;
  syncedAt: string;
}

export interface GranolaMeetingDetail extends GranolaMeetingRecord {
  transcript: GranolaTranscriptTurn[] | null;
}

export interface GranolaTranscriptTurn {
  source: "microphone" | "speaker";
  speaker: string;
  text: string;
}

export interface GranolaMeetingAttendee {
  name: string;
  email: string;
}

export interface GranolaActionItem {
  title: string;
  dueDate?: string;
  assignee?: string;
}
