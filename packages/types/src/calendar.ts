// ── Database record types ──

export interface GoogleAccountRecord {
  id: string;
  userId: string;
  googleEmail: string;
  googleUserId: string;
  connectedAt: string;
  updatedAt: string;
}

export interface CalendarListRecord {
  id: string;
  googleAccountId: string;
  googleCalendarId: string;
  name: string;
  color: string;
  isVisible: boolean;
  isPrimary: boolean;
}

export interface CalendarEventRecord {
  id: string;
  userId: string;
  googleAccountId: string;
  calendarListId: string;
  googleEventId: string;
  title: string;
  description: string | null;
  location: string | null;
  startTime: string;
  endTime: string;
  isAllDay: boolean;
  status: string;
  myResponseStatus: CalendarRsvpStatus;
  recurrence: string | null;
  recurringEventId: string | null;
  meetingLink: string | null;
  googleColorId: string | null;
  calendarName?: string;
  calendarColor?: string;
  organizer: CalendarAttendee | null;
  attendees: CalendarAttendee[];
  attachments: CalendarAttachment[];
  syncedAt: string;
  createdAt: string;
  updatedAt: string;
}

// ── View model types ──

export interface CalendarEventDisplay {
  id: string;
  title: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  color: CalendarGlassColor;
  location?: string;
  attendees?: { name: string; initials: string; email?: string; responseStatus?: string }[];
  brettObservation?: string;
  hasBrettContext: boolean;
  meetingLink?: string;
  isAllDay: boolean;
  myResponseStatus: CalendarRsvpStatus;
  recurrence?: string;
  calendarName?: string;
  description?: string;
  googleEventId: string;
}

export interface CalendarEventDetail extends CalendarEventRecord {
  calendarName: string;
  calendarColor: string;
  notes: string | null;
  brettMessages: BrettMessageRecord[];
  brettObservation: string | null;
  brettTakeGeneratedAt: string | null;
}

// ── Attendee & Attachment ──

export interface CalendarAttendee {
  name: string;
  email: string;
  responseStatus?: "accepted" | "declined" | "tentative" | "needsAction";
  comment?: string | null;
  photoUrl?: string | null;
  organizer?: boolean;
  self?: boolean;
}

export interface CalendarAttachment {
  title: string;
  url: string;
  mimeType?: string;
}

// ── RSVP ──

export type CalendarRsvpStatus = "accepted" | "declined" | "tentative" | "needsAction";

export interface RsvpInput {
  status: CalendarRsvpStatus;
  comment?: string;
}

// ── Color mapping ──

export interface CalendarGlassColor {
  bg: string;
  border: string;
  text: string;
  name: string;
}

// ── Account management ──

export interface ConnectedCalendarAccount {
  id: string;
  googleEmail: string;
  connectedAt: string;
  calendars: CalendarListRecord[];
}

// ── SSE event types ──

export type SSEEventType =
  | "calendar.event.created"
  | "calendar.event.updated"
  | "calendar.event.deleted"
  | "calendar.sync.complete"
  | "content.extracted";

export interface SSEEvent {
  type: SSEEventType;
  payload: Record<string, unknown>;
}

// ── API response types ──

export interface CalendarEventsResponse {
  events: CalendarEventRecord[];
}

export interface CalendarEventDetailResponse extends CalendarEventDetail {}

export interface BrettMessageRecord {
  id: string;
  role: "user" | "brett";
  content: string;
  createdAt: string;
}

// ── Notes ──

export interface CalendarEventNoteInput {
  content: string;
}
