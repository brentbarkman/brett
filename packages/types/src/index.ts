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

export type ContentType = "tweet" | "article" | "video" | "pdf" | "podcast" | "web_page";
export type ContentStatus = "pending" | "extracted" | "failed";

export type ContentMetadata =
  | { type: "tweet"; embedHtml?: string; author?: string; tweetText?: string }
  | { type: "video"; embedUrl: string; duration?: number; channel?: string }
  | { type: "podcast"; embedUrl: string; provider: "spotify" | "apple"; episodeName?: string; showName?: string }
  | { type: "article"; author?: string; publishDate?: string; wordCount?: number }
  | { type: "web_page" }
  | { type: "pdf" };

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
  contentType: string | null;
  contentStatus: string | null;
  contentTitle: string | null;
  contentDescription: string | null;
  contentImageUrl: string | null;
  contentBody: string | null;
  contentFavicon: string | null;
  contentDomain: string | null;
  contentMetadata: Record<string, unknown> | null;
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
  contentType?: ContentType;
  contentStatus?: ContentStatus;
  contentDomain?: string;
  contentImageUrl?: string;
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
  contentTitle?: string;
  contentDescription?: string;
  contentBody?: string;
  contentFavicon?: string;
  contentMetadata?: ContentMetadata;
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
  contentType?: ContentType;
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
  contentType?: ContentType | null;
  contentStatus?: ContentStatus | null;
  contentTitle?: string | null;
  contentDescription?: string | null;
  contentImageUrl?: string | null;
  contentBody?: string | null;
  contentFavicon?: string | null;
  contentDomain?: string | null;
  contentMetadata?: Record<string, unknown> | null;
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

export * from "./calendar";
export * from "./granola.js";

// ─── AI Types ───

export type AIProviderName = "anthropic" | "openai" | "google";
export type ModelTier = "small" | "medium" | "large";
export type ConversationSource = "omnibar" | "brett_thread" | "briefing" | "bretts_take" | "scout";
export type MessageRole = "user" | "assistant" | "tool_call" | "tool_result";
export type FactCategory = "preference" | "context" | "relationship" | "habit";

export interface UserAIConfigRecord {
  id: string;
  provider: AIProviderName;
  isValid: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationSessionRecord {
  id: string;
  source: ConversationSource;
  itemId: string | null;
  calendarEventId: string | null;
  modelTier: string;
  modelUsed: string;
  createdAt: string;
}

export interface ConversationMessageRecord {
  id: string;
  role: MessageRole;
  content: string;
  toolName: string | null;
  toolArgs: Record<string, unknown> | null;
  tokenCount: number | null;
  createdAt: string;
}

export interface UserFactRecord {
  id: string;
  category: FactCategory;
  key: string;
  value: string;
  confidence: number;
  createdAt: string;
  updatedAt: string;
}

export type StreamChunk =
  | { type: "text"; content: string }
  | { type: "tool_call"; id: string; name: string; args: Record<string, unknown> }
  | { type: "tool_result"; id: string; data: unknown; displayHint?: DisplayHint; message?: string }
  | { type: "done"; sessionId: string; usage: { input: number; output: number; cacheCreation?: number; cacheRead?: number } }
  | { type: "error"; message: string };

export type DisplayHint =
  | { type: "task_created"; taskId: string }
  | { type: "task_list"; items: { id: string; title: string; status: string }[] }
  | { type: "calendar_events"; events: { id: string; title: string; startTime: string; endTime: string }[] }
  | { type: "confirmation"; message?: string; action?: string }
  | { type: "settings_changed"; setting: string }
  | { type: "text" }
  | { type: "list" }
  | { type: "detail" };

// ─── Scout Types ───

export interface ScoutSource {
  name: string;
  url?: string; // clickable when present
}

export type ScoutStatus = "active" | "paused" | "completed" | "expired";

export interface Scout {
  id: string;
  name: string;
  avatarLetter: string;
  avatarGradient: [string, string]; // [fromColor, toColor]
  goal: string;
  context?: string;
  sources: ScoutSource[];
  sensitivity: string;
  cadenceBase: string;
  cadenceCurrent?: string;
  cadenceReason?: string;
  budgetUsed: number;
  budgetTotal: number;
  status: ScoutStatus;
  statusLine?: string; // e.g., "Monitoring closely — earnings Apr 2"
  lastRun?: string;
  endDate?: string;
  findingsCount: number;
}

export type FindingType = "insight" | "article" | "task";

export interface ScoutFinding {
  id: string;
  scoutId: string;
  type: FindingType;
  title: string;
  description: string;
  timestamp: string;
}

export type {
  WeatherCurrent,
  WeatherHourly,
  WeatherDaily,
  WeatherData,
  GeocodingResult,
  LocationSettings,
} from "./weather.js";
