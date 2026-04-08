// ────────────────────────────────────────────────────────────────────────────
// Mock Data — realistic seed data for the Brett mobile UI prototype
//
// All dates are computed relative to `new Date()` so the data stays
// "current" regardless of when the prototype is viewed.
// ────────────────────────────────────────────────────────────────────────────

export const MOCK_USER_ID = "mock-user-001";

// ── Date helpers ─────────────────────────────────────────────────────────────

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(9, 0, 0, 0);
  return d.toISOString();
}

function daysFromNow(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  d.setHours(9, 0, 0, 0);
  return d.toISOString();
}

function todayAt(hours: number, minutes = 0): string {
  const d = new Date();
  d.setHours(hours, minutes, 0, 0);
  return d.toISOString();
}

const NOW = new Date().toISOString();
const TODAY = todayAt(9);
const YESTERDAY = daysAgo(1);
const TWO_DAYS_AGO = daysAgo(2);
const THREE_DAYS_FROM_NOW = daysFromNow(3);
const FIVE_DAYS_FROM_NOW = daysFromNow(5);
const EIGHT_DAYS_FROM_NOW = daysFromNow(8);

// ── Types ─────────────────────────────────────────────────────────────────────

export interface MockItem {
  id: string;
  type: "task" | "content";
  status: "active" | "done" | "snoozed" | "archived";
  title: string;
  description: string | null;
  notes: string | null;
  dueDate: string | null;
  completedAt: string | null;
  reminder: string | null;
  recurrence: string | null;
  recurrenceRule: string | null;
  contentType: string | null;
  contentDomain: string | null;
  contentDescription: string | null;
  listId: string | null;
  userId: string;
  createdAt: string;
  updatedAt: string;
  /** Computed urgency bucket for display */
  urgency: "overdue" | "today" | "this_week" | null;
}

export interface MockList {
  id: string;
  name: string;
  colorClass: string;
  sortOrder: number;
  archivedAt: string | null;
  userId: string;
}

export interface MockCalendarEvent {
  id: string;
  title: string;
  startTime: string;
  endTime: string;
  location: string | null;
  meetingLink: string | null;
  attendees: string[];
  description: string | null;
  isAllDay: boolean;
  calendarColor: string;
}

export interface MockScout {
  id: string;
  name: string;
  goal: string;
  status: "active" | "paused" | "error";
  lastFindingAt: string | null;
  findingCount: number;
  sources: string[];
}

export interface MockScoutFinding {
  id: string;
  scoutId: string;
  type: "insight" | "article" | "task";
  title: string;
  summary: string;
  relevanceScore: number;
  reasoning: string;
  sourceUrl: string | null;
  createdAt: string;
}

export interface MockSubtask {
  id: string;
  title: string;
  done: boolean;
}

// ── Lists ─────────────────────────────────────────────────────────────────────

export const MOCK_LISTS: MockList[] = [
  {
    id: "list-work",
    name: "Work",
    colorClass: "bg-blue-500",
    sortOrder: 0,
    archivedAt: null,
    userId: MOCK_USER_ID,
  },
  {
    id: "list-personal",
    name: "Personal",
    colorClass: "bg-amber-500",
    sortOrder: 1,
    archivedAt: null,
    userId: MOCK_USER_ID,
  },
  {
    id: "list-health",
    name: "Health",
    colorClass: "bg-emerald-500",
    sortOrder: 2,
    archivedAt: null,
    userId: MOCK_USER_ID,
  },
  {
    id: "list-side-project",
    name: "Side Project",
    colorClass: "bg-purple-500",
    sortOrder: 3,
    archivedAt: null,
    userId: MOCK_USER_ID,
  },
];

// ── Items ─────────────────────────────────────────────────────────────────────

export const MOCK_ITEMS: MockItem[] = [
  // ── Overdue (2) ────────────────────────────────────────────────────────────
  {
    id: "item-overdue-1",
    type: "task",
    status: "active",
    title: "Submit Q1 expense report",
    description: "Finance deadline passed — needs receipts from Feb & Mar travel",
    notes: null,
    dueDate: TWO_DAYS_AGO,
    completedAt: null,
    reminder: null,
    recurrence: null,
    recurrenceRule: null,
    contentType: null,
    contentDomain: null,
    contentDescription: null,
    listId: "list-work",
    userId: MOCK_USER_ID,
    createdAt: daysAgo(10),
    updatedAt: TWO_DAYS_AGO,
    urgency: "overdue",
  },
  {
    id: "item-overdue-2",
    type: "task",
    status: "active",
    title: "Renew gym membership",
    description: "Auto-pay failed — card expired",
    notes: null,
    dueDate: YESTERDAY,
    completedAt: null,
    reminder: null,
    recurrence: null,
    recurrenceRule: null,
    contentType: null,
    contentDomain: null,
    contentDescription: null,
    listId: "list-health",
    userId: MOCK_USER_ID,
    createdAt: daysAgo(7),
    updatedAt: YESTERDAY,
    urgency: "overdue",
  },

  // ── Today (4) ──────────────────────────────────────────────────────────────
  {
    id: "item-today-1",
    type: "task",
    status: "active",
    title: "Prep slides for Q2 review",
    description: "Cover revenue targets, pipeline, and team headcount ask",
    notes: "Use last quarter's deck as a template. Focus on YoY growth metrics.",
    dueDate: TODAY,
    completedAt: null,
    reminder: todayAt(8, 30),
    recurrence: null,
    recurrenceRule: null,
    contentType: null,
    contentDomain: null,
    contentDescription: null,
    listId: "list-work",
    userId: MOCK_USER_ID,
    createdAt: daysAgo(3),
    updatedAt: TODAY,
    urgency: "today",
  },
  {
    id: "item-today-2",
    type: "task",
    status: "active",
    title: "Write weekly team update",
    description: "Slack post for #engineering-updates — shipped features, blockers, next week",
    notes: null,
    dueDate: TODAY,
    completedAt: null,
    reminder: null,
    recurrence: "weekly",
    recurrenceRule: "FREQ=WEEKLY;BYDAY=WE",
    contentType: null,
    contentDomain: null,
    contentDescription: null,
    listId: "list-work",
    userId: MOCK_USER_ID,
    createdAt: daysAgo(14),
    updatedAt: TODAY,
    urgency: "today",
  },
  {
    id: "item-today-3",
    type: "task",
    status: "active",
    title: "30-min walk after lunch",
    description: null,
    notes: null,
    dueDate: TODAY,
    completedAt: null,
    reminder: todayAt(13, 0),
    recurrence: "daily",
    recurrenceRule: "FREQ=DAILY",
    contentType: null,
    contentDomain: null,
    contentDescription: null,
    listId: "list-health",
    userId: MOCK_USER_ID,
    createdAt: daysAgo(30),
    updatedAt: TODAY,
    urgency: "today",
  },
  {
    id: "item-today-4",
    type: "task",
    status: "active",
    title: "Push mobile auth fix to staging",
    description: "Token refresh edge case — SSE reconnect loop on expiry",
    notes: null,
    dueDate: TODAY,
    completedAt: null,
    reminder: null,
    recurrence: null,
    recurrenceRule: null,
    contentType: null,
    contentDomain: null,
    contentDescription: null,
    listId: "list-side-project",
    userId: MOCK_USER_ID,
    createdAt: daysAgo(2),
    updatedAt: TODAY,
    urgency: "today",
  },

  // ── Done today (3) ─────────────────────────────────────────────────────────
  {
    id: "item-done-1",
    type: "task",
    status: "done",
    title: "Morning standup",
    description: null,
    notes: null,
    dueDate: TODAY,
    completedAt: todayAt(9, 15),
    reminder: null,
    recurrence: "daily",
    recurrenceRule: "FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR",
    contentType: null,
    contentDomain: null,
    contentDescription: null,
    listId: "list-work",
    userId: MOCK_USER_ID,
    createdAt: daysAgo(60),
    updatedAt: todayAt(9, 15),
    urgency: "today",
  },
  {
    id: "item-done-2",
    type: "task",
    status: "done",
    title: "Review Ali's PR — pagination refactor",
    description: null,
    notes: null,
    dueDate: TODAY,
    completedAt: todayAt(8, 45),
    reminder: null,
    recurrence: null,
    recurrenceRule: null,
    contentType: null,
    contentDomain: null,
    contentDescription: null,
    listId: "list-work",
    userId: MOCK_USER_ID,
    createdAt: daysAgo(1),
    updatedAt: todayAt(8, 45),
    urgency: "today",
  },
  {
    id: "item-done-3",
    type: "task",
    status: "done",
    title: "Book physio appointment",
    description: null,
    notes: null,
    dueDate: TODAY,
    completedAt: todayAt(7, 30),
    reminder: null,
    recurrence: null,
    recurrenceRule: null,
    contentType: null,
    contentDomain: null,
    contentDescription: null,
    listId: "list-health",
    userId: MOCK_USER_ID,
    createdAt: daysAgo(3),
    updatedAt: todayAt(7, 30),
    urgency: "today",
  },

  // ── This week (2) ──────────────────────────────────────────────────────────
  {
    id: "item-week-1",
    type: "task",
    status: "active",
    title: "Draft technical spec for sync v2",
    description: "Cover conflict resolution, partial-sync, and multi-device ordering",
    notes: null,
    dueDate: THREE_DAYS_FROM_NOW,
    completedAt: null,
    reminder: null,
    recurrence: null,
    recurrenceRule: null,
    contentType: null,
    contentDomain: null,
    contentDescription: null,
    listId: "list-work",
    userId: MOCK_USER_ID,
    createdAt: daysAgo(4),
    updatedAt: daysAgo(4),
    urgency: "this_week",
  },
  {
    id: "item-week-2",
    type: "task",
    status: "active",
    title: "Research standing desk options",
    description: "Budget ~$600. Need: height memory presets, cable tray, 60″ min.",
    notes: null,
    dueDate: FIVE_DAYS_FROM_NOW,
    completedAt: null,
    reminder: null,
    recurrence: null,
    recurrenceRule: null,
    contentType: null,
    contentDomain: null,
    contentDescription: null,
    listId: "list-personal",
    userId: MOCK_USER_ID,
    createdAt: daysAgo(5),
    updatedAt: daysAgo(5),
    urgency: "this_week",
  },

  // ── Inbox — no dueDate, no listId (6) ─────────────────────────────────────
  {
    id: "item-inbox-1",
    type: "task",
    status: "active",
    title: "Figure out 2026 vacation days",
    description: null,
    notes: null,
    dueDate: null,
    completedAt: null,
    reminder: null,
    recurrence: null,
    recurrenceRule: null,
    contentType: null,
    contentDomain: null,
    contentDescription: null,
    listId: null,
    userId: MOCK_USER_ID,
    createdAt: daysAgo(1),
    updatedAt: daysAgo(1),
    urgency: null,
  },
  {
    id: "item-inbox-2",
    type: "task",
    status: "active",
    title: "Look into Expo OTA update strategy for prod",
    description: null,
    notes: null,
    dueDate: null,
    completedAt: null,
    reminder: null,
    recurrence: null,
    recurrenceRule: null,
    contentType: null,
    contentDomain: null,
    contentDescription: null,
    listId: null,
    userId: MOCK_USER_ID,
    createdAt: daysAgo(2),
    updatedAt: daysAgo(2),
    urgency: null,
  },
  {
    id: "item-inbox-3",
    type: "content",
    status: "active",
    title: "Why React Compiler changes how you think about memoization",
    description: null,
    notes: null,
    dueDate: null,
    completedAt: null,
    reminder: null,
    recurrence: null,
    recurrenceRule: null,
    contentType: "web_page",
    contentDomain: "react.dev",
    contentDescription: "Deep dive into the React Compiler's auto-memoization model and what it means for day-to-day component authoring.",
    listId: null,
    userId: MOCK_USER_ID,
    createdAt: daysAgo(1),
    updatedAt: daysAgo(1),
    urgency: null,
  },
  {
    id: "item-inbox-4",
    type: "content",
    status: "active",
    title: "The Morning Brew — AI edition",
    description: null,
    notes: null,
    dueDate: null,
    completedAt: null,
    reminder: null,
    recurrence: null,
    recurrenceRule: null,
    contentType: "web_page",
    contentDomain: "morningbrew.com",
    contentDescription: "Today's top stories in AI: OpenAI model pricing cuts, Claude context window expansion, and Mistral's new on-device model.",
    listId: null,
    userId: MOCK_USER_ID,
    createdAt: daysAgo(0),
    updatedAt: daysAgo(0),
    urgency: null,
  },
  {
    id: "item-inbox-5",
    type: "content",
    status: "active",
    title: "Hacker News Digest — top 10 this week",
    description: null,
    notes: null,
    dueDate: null,
    completedAt: null,
    reminder: null,
    recurrence: null,
    recurrenceRule: null,
    contentType: "web_page",
    contentDomain: "hackernewsdigest.com",
    contentDescription: "Curated top 10 from HN this week: SQLite in prod, Rust vs Go in 2026, and building offline-first mobile apps.",
    listId: null,
    userId: MOCK_USER_ID,
    createdAt: daysAgo(0),
    updatedAt: daysAgo(0),
    urgency: null,
  },
  {
    id: "item-inbox-6",
    type: "task",
    status: "active",
    title: "Explore Tauri v2 for the desktop app",
    description: "Compare bundle size, startup perf, and native API surface vs Electron",
    notes: null,
    dueDate: null,
    completedAt: null,
    reminder: null,
    recurrence: null,
    recurrenceRule: null,
    contentType: null,
    contentDomain: null,
    contentDescription: null,
    listId: null,
    userId: MOCK_USER_ID,
    createdAt: daysAgo(3),
    updatedAt: daysAgo(3),
    urgency: null,
  },

  // ── Upcoming (3) ──────────────────────────────────────────────────────────
  {
    id: "item-upcoming-1",
    type: "task",
    status: "active",
    title: "Annual performance self-review",
    description: "HR portal opens next week — block 2h",
    notes: null,
    dueDate: EIGHT_DAYS_FROM_NOW,
    completedAt: null,
    reminder: null,
    recurrence: null,
    recurrenceRule: null,
    contentType: null,
    contentDomain: null,
    contentDescription: null,
    listId: "list-work",
    userId: MOCK_USER_ID,
    createdAt: daysAgo(2),
    updatedAt: daysAgo(2),
    urgency: null,
  },
  {
    id: "item-upcoming-2",
    type: "task",
    status: "active",
    title: "Plan birthday dinner for Sam",
    description: "Saturday the 19th — book restaurant by end of week",
    notes: null,
    dueDate: daysFromNow(11),
    completedAt: null,
    reminder: daysFromNow(8),
    recurrence: null,
    recurrenceRule: null,
    contentType: null,
    contentDomain: null,
    contentDescription: null,
    listId: "list-personal",
    userId: MOCK_USER_ID,
    createdAt: daysAgo(1),
    updatedAt: daysAgo(1),
    urgency: null,
  },
  {
    id: "item-upcoming-3",
    type: "task",
    status: "active",
    title: "Ship public beta of side project",
    description: "Goal: ProductHunt launch end of month",
    notes: null,
    dueDate: daysFromNow(20),
    completedAt: null,
    reminder: null,
    recurrence: null,
    recurrenceRule: null,
    contentType: null,
    contentDomain: null,
    contentDescription: null,
    listId: "list-side-project",
    userId: MOCK_USER_ID,
    createdAt: daysAgo(14),
    updatedAt: daysAgo(14),
    urgency: null,
  },
];

// ── Subtasks ─────────────────────────────────────────────────────────────────

export const MOCK_SUBTASKS: Record<string, MockSubtask[]> = {
  "item-today-1": [
    { id: "sub-1-1", title: "Pull metrics from analytics dashboard", done: true },
    { id: "sub-1-2", title: "Add pipeline slide with deal stages", done: false },
    { id: "sub-1-3", title: "Write exec summary (3 bullets max)", done: false },
  ],
  "item-today-2": [
    { id: "sub-2-1", title: "List shipped features this week", done: true },
    { id: "sub-2-2", title: "Note any open blockers", done: false },
    { id: "sub-2-3", title: "Preview what's landing next week", done: false },
  ],
};

// ── Calendar Events ───────────────────────────────────────────────────────────

export const MOCK_CALENDAR_EVENTS: MockCalendarEvent[] = [
  {
    id: "cal-1",
    title: "Q2 Review",
    startTime: todayAt(10, 0),
    endTime: todayAt(11, 0),
    location: "Conf Room B",
    meetingLink: "https://meet.google.com/abc-defg-hij",
    attendees: ["alice@company.com", "bob@company.com", "carol@company.com"],
    description: "Quarterly business review — revenue, pipeline, team asks",
    isAllDay: false,
    calendarColor: "#4285F4",
  },
  {
    id: "cal-2",
    title: "Design Sync",
    startTime: todayAt(11, 0),
    endTime: todayAt(11, 30),
    location: null,
    meetingLink: "https://meet.google.com/klm-nopq-rst",
    attendees: ["alice@company.com", "dana@company.com"],
    description: "Weekly mobile UI review — review new screens, alignment on interactions",
    isAllDay: false,
    calendarColor: "#0F9D58",
  },
  {
    id: "cal-3",
    title: "1:1 with Manager",
    startTime: todayAt(14, 0),
    endTime: todayAt(14, 45),
    location: null,
    meetingLink: "https://zoom.us/j/123456789",
    attendees: ["alice@company.com", "manager@company.com"],
    description: "Weekly 1:1 — career check-in, current projects, blockers",
    isAllDay: false,
    calendarColor: "#DB4437",
  },
];

// ── Scouts ────────────────────────────────────────────────────────────────────

export const MOCK_SCOUTS: MockScout[] = [
  {
    id: "scout-1",
    name: "AI Competitor Watch",
    goal: "Track product launches and pricing changes from Linear, Notion, and Todoist. Flag anything that could affect our roadmap.",
    status: "active",
    lastFindingAt: daysAgo(1),
    findingCount: 14,
    sources: ["techcrunch.com", "producthunt.com", "twitter.com", "hacker news"],
  },
  {
    id: "scout-2",
    name: "React Native Updates",
    goal: "Monitor React Native and Expo changelog, GitHub releases, and community blogs. Surface breaking changes and new APIs relevant to the mobile app.",
    status: "active",
    lastFindingAt: daysAgo(2),
    findingCount: 7,
    sources: ["github.com/facebook/react-native", "expo.dev/changelog", "reactnative.dev"],
  },
  {
    id: "scout-3",
    name: "Standing Desk Deals",
    goal: "Find deals on standing desks under $700. Must have height memory presets and at least 60\" width. Alert when a good deal appears.",
    status: "paused",
    lastFindingAt: daysAgo(5),
    findingCount: 3,
    sources: ["wirecutter.com", "amazon.com", "rtings.com"],
  },
];

// ── Scout Findings ────────────────────────────────────────────────────────────

export const MOCK_SCOUT_FINDINGS: MockScoutFinding[] = [
  {
    id: "finding-1",
    scoutId: "scout-1",
    type: "insight",
    title: "Linear ships AI-powered triage — auto-assigns priority and owner",
    summary: "Linear's new AI Triage feature automatically assigns priority levels and suggests owners based on issue content and team workload patterns. Available in all plans as of this week.",
    relevanceScore: 0.91,
    reasoning: "Direct competitor feature in the task management space. Priority triage is on our backlog — this signals market validation and raises the urgency.",
    sourceUrl: "https://linear.app/blog/ai-triage",
    createdAt: daysAgo(1),
  },
  {
    id: "finding-2",
    scoutId: "scout-2",
    type: "article",
    title: "Expo SDK 55 drops support for React Native < 0.74",
    summary: "Expo 55 release notes confirm minimum React Native version is now 0.74. Projects on older RN versions must upgrade before migrating. New APIs: Camera v3, improved Haptics module.",
    relevanceScore: 0.87,
    reasoning: "Directly affects the mobile app. Upgrade path is relevant for the next sprint — need to verify current RN version and check for breaking changes.",
    sourceUrl: "https://expo.dev/changelog/sdk-55",
    createdAt: daysAgo(2),
  },
  {
    id: "finding-3",
    scoutId: "scout-3",
    type: "task",
    title: "Uplift Desk U2 Pro — $619 (was $699)",
    summary: "The Uplift V2 Pro 60\" is currently $619 on their site with the spring sale. Matches all criteria: height memory presets, cable tray included, 60\" surface. Sale ends Sunday.",
    relevanceScore: 0.83,
    reasoning: "Within budget, matches all stated requirements. Time-sensitive — sale ends in 3 days.",
    sourceUrl: "https://www.upliftdesk.com/uplift-v2-pro-standing-desk",
    createdAt: daysAgo(3),
  },
];

// ── Daily Briefing ────────────────────────────────────────────────────────────

export const MOCK_BRIEFING = {
  content: `Good morning. You have **3 meetings today** starting at 10am with the Q2 Review — your slides are still in progress.

**2 overdue tasks** need attention before end of day: the Q1 expense report is 2 days late, and your gym membership lapsed yesterday.

Your AI Competitor Watch scout flagged something worth reading: **Linear just shipped AI triage**, which lands squarely on your own roadmap. Worth a 5-minute read before the design sync.

Focus recommendation: clear the **expense report first** (30 min), prep the **Q2 slides** (45 min), then you're in good shape for the 10am.`,
  generatedAt: todayAt(6, 30),
};

// ── Helper ────────────────────────────────────────────────────────────────────

export function getListForItem(item: MockItem): MockList | undefined {
  if (!item.listId) return undefined;
  return MOCK_LISTS.find((l) => l.id === item.listId);
}
