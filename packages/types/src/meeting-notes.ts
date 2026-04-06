// ── Granola account types (provider-specific) ──

export interface GranolaAccountRecord {
  id: string;
  email: string;
  lastSyncAt: string | null;
  autoCreateMyTasks: boolean;
  autoCreateFollowUps: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface GranolaAccountStatus {
  connected: boolean;
  account: GranolaAccountRecord | null;
}

// ── Meeting note types (provider-agnostic) ──

export interface MeetingNoteSourceRecord {
  id: string;
  provider: string;
  externalId: string;
  title: string;
  summary: string | null;
  syncedAt: string;
}

export interface MeetingNoteRecord {
  id: string;
  granolaDocumentId?: string | null;
  calendarEventId: string | null;
  title: string;
  summary: string | null;
  attendees: MeetingNoteAttendee[] | null;
  actionItems: MeetingActionItem[] | null;
  meetingStartedAt: string;
  meetingEndedAt: string;
  syncedAt: string;
  sources: string[];
}

export interface MeetingNoteDetail extends MeetingNoteRecord {
  transcript: MeetingTranscriptTurn[] | null;
  items?: MeetingLinkedItem[];
  sources: string[];
  meetingNoteSources?: MeetingNoteSourceRecord[];
}

export interface MeetingLinkedItem {
  id: string;
  title: string;
  status: string;
  dueDate: string | null;
}

export interface MeetingTranscriptTurn {
  source: "microphone" | "speaker";
  speaker: string;
  text: string;
}

export interface MeetingNoteAttendee {
  name: string;
  email: string;
}

export interface MeetingActionItem {
  title: string;
  dueDate?: string;
  assignee?: string;
  assigneeName?: string;
}
