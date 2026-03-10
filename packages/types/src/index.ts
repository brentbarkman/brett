export interface User {
  id: string;
  email: string;
  name: string;
  createdAt: Date;
}

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

export type ItemType = "task" | "scout" | "saved_web" | "saved_tweet";
export type Urgency = "overdue" | "today" | "this_week" | "done";

export interface Thing {
  id: string;
  type: ItemType;
  title: string;
  list: string;
  source: string;
  urgency: Urgency;
  dueDateLabel?: string;
  isCompleted: boolean;
  brettObservation?: string;
  description?: string;
  stalenessDays?: number;
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
