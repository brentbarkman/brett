export interface User {
  id: string;
  email: string;
  name: string;
  avatarUrl?: string | null;
  createdAt: Date;
  updatedAt?: Date;
}

export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
}

/** @deprecated Use ItemRecord + itemToThing() instead */
export interface Task {
  id: string;
  title: string;
  description?: string;
  completed: boolean;
  userId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Notification {
  id: string;
  userId: string;
  title: string;
  body: string;
  read: boolean;
  createdAt: Date;
}

// Dashboard types

export type ItemType = "task" | "content";
export type ItemStatus = "active" | "snoozed" | "done" | "archived";
export type Urgency = "overdue" | "today" | "this_week" | "next_week" | "later" | "done";

/** DB record — mirrors the Prisma Item model */
export type DueDatePrecision = "day" | "week";
export type ReminderType = "morning_of" | "1_hour_before" | "day_before" | "custom";
export type RecurrenceType = "daily" | "weekly" | "monthly" | "custom";

/** DB record — mirrors the Prisma Item model */
export interface ItemRecord {
  id: string;
  type: string;
  status: string;
  title: string;
  description: string | null;
  source: string;
  sourceUrl: string | null;
  dueDate: Date | null;
  dueDatePrecision: string | null; // "day" | "week"
  completedAt: Date | null;
  snoozedUntil: Date | null;
  brettObservation: string | null;
  notes: string | null;
  reminder: string | null;
  recurrence: string | null;
  recurrenceRule: string | null;
  brettTakeGeneratedAt: Date | null;
  listId: string | null;
  userId: string;
  createdAt: Date;
  updatedAt: Date;
}

/** Computed view model for the UI */
export interface Thing {
  id: string;
  type: ItemType;
  title: string;
  list: string;
  listId: string | null;
  status: ItemStatus;
  source: string;
  sourceUrl?: string;
  urgency: Urgency;
  dueDate?: string; // ISO string
  dueDatePrecision?: DueDatePrecision;
  dueDateLabel?: string;
  isCompleted: boolean;
  completedAt?: string; // ISO string
  brettObservation?: string;
  description?: string;
  stalenessDays?: number;
  createdAt?: string; // ISO string, populated for inbox items
}

export interface Attachment {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  url: string; // presigned S3 URL
  createdAt: string; // ISO string
}

export interface ItemLink {
  id: string;
  toItemId: string;
  toItemType: string;
  toItemTitle?: string; // resolved on read
  createdAt: string;
}

export interface BrettMessage {
  id: string;
  role: "user" | "brett";
  content: string;
  createdAt: string;
}

export interface ThingDetail extends Thing {
  notes?: string;
  reminder?: ReminderType;
  recurrence?: RecurrenceType;
  recurrenceRule?: string;
  brettTakeGeneratedAt?: string;
  attachments: Attachment[];
  links: ItemLink[];
  brettMessages: BrettMessage[];
}

export interface CreateItemInput {
  type: string;
  title: string;
  description?: string;
  source?: string;
  sourceUrl?: string;
  dueDate?: string; // ISO string
  dueDatePrecision?: DueDatePrecision;
  brettObservation?: string;
  listId?: string;
  status?: ItemStatus;
}

export interface UpdateItemInput {
  title?: string;
  description?: string | null;
  source?: string;
  sourceUrl?: string | null;
  dueDate?: string | null; // ISO string
  dueDatePrecision?: DueDatePrecision | null;
  brettObservation?: string | null;
  listId?: string | null;
  status?: ItemStatus;
  snoozedUntil?: string | null; // ISO string
  notes?: string | null;
  reminder?: ReminderType | null;
  recurrence?: RecurrenceType | null;
  recurrenceRule?: string | null;
}

export interface CreateListInput {
  name: string;
  colorClass?: string;
}

export interface UpdateListInput {
  name?: string;
  colorClass?: string;
}

export interface BulkUpdateInput {
  ids: string[];
  updates: {
    listId?: string | null;
    dueDate?: string | null;
    dueDatePrecision?: DueDatePrecision | null;
    status?: ItemStatus;
  };
}

export interface InboxResponse {
  visible: Thing[];
}

export interface CalendarEvent {
  id: string;
  title: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  color: "blue" | "green" | "purple" | "amber";
  location?: string;
  attendees?: { name: string; initials: string }[];
  brettObservation?: string;
  hasBrettContext: boolean;
}

export interface NavList {
  id: string;
  name: string;
  count: number;
  completedCount: number;
  colorClass: string;
  sortOrder: number;
  archivedAt?: string | null;
}

export interface UpcomingSection {
  label: string;
  things: Thing[];
}

export type FilterType = "All" | "Tasks" | "Content";

export interface CreateItemLinkInput {
  toItemId: string;
  toItemType: string;
}

export interface CreateBrettMessageInput {
  content: string;
}
