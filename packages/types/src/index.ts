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
export type ItemStatus = "inbox" | "active" | "snoozed" | "done" | "archived";
export type Urgency = "overdue" | "today" | "this_week" | "done";

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
  completedAt: Date | null;
  snoozedUntil: Date | null;
  brettObservation: string | null;
  listId: string;
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
  listId: string;
  status: ItemStatus;
  source: string;
  sourceUrl?: string;
  urgency: Urgency;
  dueDateLabel?: string;
  isCompleted: boolean;
  brettObservation?: string;
  description?: string;
  stalenessDays?: number;
}

export interface CreateItemInput {
  type: string;
  title: string;
  description?: string;
  source?: string;
  sourceUrl?: string;
  dueDate?: string; // ISO string
  brettObservation?: string;
  listId: string;
  status?: ItemStatus;
}

export interface UpdateItemInput {
  title?: string;
  description?: string | null;
  source?: string;
  sourceUrl?: string | null;
  dueDate?: string | null; // ISO string
  brettObservation?: string | null;
  listId?: string;
  status?: ItemStatus;
  snoozedUntil?: string | null; // ISO string
}

export interface CreateListInput {
  name: string;
  colorClass?: string;
}

export interface UpdateListInput {
  name?: string;
  colorClass?: string;
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
  colorClass: string;
}
