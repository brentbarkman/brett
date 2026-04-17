# Brett Mobile UI Prototype — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the complete Brett mobile UI with mock data — every screen, gesture, animation, and haptic from the design spec — ready for visual iteration on device before wiring to real data.

**Architecture:** Mock data layer provides realistic items/lists/events/briefing through the same hook interface the real stores use. All UI components consume hooks, making the swap to real data trivial later. Expo Router file-based routing with a tab layout nested inside a stack for push navigation.

**Tech Stack:** Expo 55, React Native, Expo Router (tabs + stack), react-native-reanimated (animations/gestures), react-native-gesture-handler (swipes), expo-blur (glass surfaces), expo-haptics, Lucide React Native (icons)

**Design Spec:** `docs/superpowers/specs/2026-04-08-mobile-ux-design.md`

---

## File Structure

```
apps/mobile/
  app/
    _layout.tsx                          — Root: AuthGate (MODIFY — keep auth logic)
    (auth)/
      _layout.tsx                        — Auth stack (KEEP)
      sign-in.tsx                        — Sign in (KEEP, update styling later)
    (app)/
      _layout.tsx                        — Stack navigator wrapping tabs + push screens (REWRITE)
      (tabs)/
        _layout.tsx                      — CREATE: Custom tab bar with voice button
        today.tsx                        — CREATE: Today screen (replaces old today.tsx)
        inbox.tsx                        — CREATE: Inbox screen
        upcoming.tsx                     — CREATE: Upcoming screen
        calendar.tsx                     — CREATE: Calendar screen
      task/[id].tsx                      — CREATE: Task detail (full-screen push)
      list/[id].tsx                      — CREATE: List detail
      settings.tsx                       — CREATE: Settings screen
      scouts/index.tsx                   — CREATE: Scouts roster
      scouts/[id].tsx                    — CREATE: Scout detail
      content/[id].tsx                   — CREATE: Content detail
  src/
    mock/
      data.ts                            — CREATE: All mock data (items, lists, events, scouts, briefing)
      hooks.ts                           — CREATE: Mock hook implementations matching real interface
    theme/
      tokens.ts                          — CREATE: Design tokens (colors, typography, spacing, radii)
      haptics.ts                         — CREATE: Haptic feedback utilities
    components/
      LivingBackground.tsx               — CREATE: Dynamic background with mock time segments
      GlassCard.tsx                      — CREATE: Glass surface with expo-blur
      TaskRow.tsx                        — CREATE: Task row with checkbox, gestures
      SectionHeader.tsx                  — CREATE: Uppercase section label
      Omnibar.tsx                        — CREATE: Capture input pinned above tab bar
      TabBar.tsx                         — CREATE: Custom tab bar with voice button + gold indicator
      NextUpCard.tsx                     — CREATE: Next calendar event
      DailyBriefing.tsx                  — CREATE: AI briefing card (collapsible, dismissible)
      EmptyState.tsx                     — CREATE: Personality-driven empty states
      WeekStrip.tsx                      — CREATE: Horizontal week navigation
      TimelineEvent.tsx                  — CREATE: Calendar timeline event block
      MultiSelectToolbar.tsx             — CREATE: Bottom toolbar for batch actions
      ContextualDrawer.tsx               — CREATE: Long-press drawer (half-sheet)
      VoiceMode.tsx                      — CREATE: Voice activation overlay + theater
      MorningRitual.tsx                  — CREATE: Staggered cascade animation wrapper
      HeaderStats.tsx                    — CREATE: Date + progress + meetings line
    hooks/
      use-batch-completion.ts            — CREATE: Delayed reflow logic (1.5s debounce)
      use-morning-ritual.ts              — CREATE: First-open-of-day tracker
      use-reduce-motion.ts               — CREATE: Accessibility motion preference
```

---

## Task 1: Install Dependencies & Create Design Tokens

**Files:**
- Modify: `apps/mobile/package.json`
- Create: `apps/mobile/src/theme/tokens.ts`
- Create: `apps/mobile/src/theme/haptics.ts`

- [ ] **Step 1: Install animation, gesture, blur, haptics, and icon dependencies**

```bash
cd apps/mobile
pnpm add react-native-reanimated react-native-gesture-handler expo-blur expo-haptics expo-linear-gradient lucide-react-native react-native-svg
```

- [ ] **Step 2: Add reanimated babel plugin**

In `apps/mobile/babel.config.js`, add `react-native-reanimated/plugin` as the last plugin:

```js
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: ['react-native-reanimated/plugin'],
  };
};
```

- [ ] **Step 3: Create design tokens**

```typescript
// apps/mobile/src/theme/tokens.ts

export const colors = {
  // Backgrounds
  backgroundPrimary: '#000000',

  // Brand
  gold: '#E8B931',
  goldMuted: 'rgba(232, 185, 49, 0.5)',
  goldSubtle: 'rgba(232, 185, 49, 0.12)',
  goldGhost: 'rgba(232, 185, 49, 0.06)',

  cerulean: '#4682C3',
  ceruleanMuted: 'rgba(70, 130, 195, 0.5)',
  ceruleanSubtle: 'rgba(70, 130, 195, 0.12)',
  ceruleanGhost: 'rgba(70, 130, 195, 0.06)',

  teal: '#48BBA0',
  tealSubtle: 'rgba(72, 187, 160, 0.12)',

  red: '#E6554B',
  redSubtle: 'rgba(230, 85, 75, 0.12)',

  // Surfaces (glass)
  glassPrimary: 'rgba(0, 0, 0, 0.3)',
  glassLight: 'rgba(0, 0, 0, 0.2)',
  glassElevated: 'rgba(0, 0, 0, 0.4)',
  glassHeavy: 'rgba(0, 0, 0, 0.5)',

  // Text (always white + opacity)
  textPrimary: 'rgba(255, 255, 255, 0.85)',
  textSecondary: 'rgba(255, 255, 255, 0.40)',
  textTertiary: 'rgba(255, 255, 255, 0.25)',
  textGhost: 'rgba(255, 255, 255, 0.15)',
  textFull: 'rgba(255, 255, 255, 1.0)',

  // Borders
  borderSubtle: 'rgba(255, 255, 255, 0.06)',
  borderMedium: 'rgba(255, 255, 255, 0.10)',
  borderVisible: 'rgba(255, 255, 255, 0.15)',
} as const;

export const typography = {
  pageHeader: { fontSize: 22, fontWeight: '700' as const, color: colors.textFull },
  sectionTitle: { fontSize: 18, fontWeight: '600' as const, color: 'rgba(255,255,255,0.9)' },
  sectionLabel: { fontSize: 10, fontWeight: '600' as const, textTransform: 'uppercase' as const, letterSpacing: 1.5, color: colors.textTertiary },
  taskTitle: { fontSize: 15, fontWeight: '500' as const, color: colors.textPrimary },
  body: { fontSize: 14, fontWeight: '400' as const, color: 'rgba(255,255,255,0.7)' },
  metadata: { fontSize: 12, fontWeight: '400' as const, color: colors.textSecondary },
  caption: { fontSize: 11, fontWeight: '400' as const, color: colors.textSecondary },
  tabLabel: { fontSize: 10, fontWeight: '500' as const },
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
} as const;

export const radii = {
  card: 14,
  taskRow: 11,
  button: 8,
  omnibar: 12,
  full: 9999,
} as const;

export const touchTargetMin = 44;
```

- [ ] **Step 4: Create haptic utilities**

```typescript
// apps/mobile/src/theme/haptics.ts

import * as Haptics from 'expo-haptics';

export const haptic = {
  /** Task completion — satisfying double-tap */
  completion: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),

  /** Checkbox tap, capture submit — crisp acknowledgment */
  light: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light),

  /** Swipe threshold, pull-to-refresh — commitment point */
  medium: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium),

  /** Voice mode activate — weighty, intentional */
  heavy: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy),

  /** Drag-to-reorder lift — physical pickup */
  rigid: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Rigid),

  /** Error/failure — three rapid taps */
  error: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error),
} as const;
```

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(mobile): install deps and create design tokens + haptic utils"
```

---

## Task 2: Mock Data Layer

**Files:**
- Create: `apps/mobile/src/mock/data.ts`
- Create: `apps/mobile/src/mock/hooks.ts`

- [ ] **Step 1: Create mock data**

Create realistic mock data that exercises all UI states. Include overdue tasks, today tasks, this-week tasks, done tasks, inbox items, newsletters, content, lists, calendar events, scouts, and a briefing.

```typescript
// apps/mobile/src/mock/data.ts

import { generateId } from '@brett/utils';

// ============================================
// Types (matching real ItemRow, ListRow, etc.)
// ============================================

export interface MockItem {
  id: string;
  type: 'task' | 'content';
  status: 'active' | 'done' | 'snoozed' | 'archived';
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
  urgency?: 'overdue' | 'today' | 'this_week' | null;
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
  status: 'active' | 'paused' | 'error';
  lastFindingAt: string | null;
  findingCount: number;
  sources: string[];
}

export interface MockScoutFinding {
  id: string;
  scoutId: string;
  type: 'insight' | 'article' | 'task';
  title: string;
  summary: string;
  relevanceScore: number;
  reasoning: string;
  sourceUrl: string | null;
  createdAt: string;
}

// ============================================
// Helper — dates relative to "now"
// ============================================

const now = new Date();
const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
const dayAfterTomorrow = new Date(today); dayAfterTomorrow.setDate(today.getDate() + 2);
const threeDaysOut = new Date(today); threeDaysOut.setDate(today.getDate() + 3);
const fourDaysOut = new Date(today); fourDaysOut.setDate(today.getDate() + 4);
const fiveDaysOut = new Date(today); fiveDaysOut.setDate(today.getDate() + 5);

function todayAt(hour: number, min = 0): string {
  const d = new Date(today);
  d.setHours(hour, min, 0, 0);
  return d.toISOString();
}

const MOCK_USER_ID = 'mock-user-001';

// ============================================
// Lists
// ============================================

export const mockLists: MockList[] = [
  { id: 'list-work', name: 'Work', colorClass: 'bg-blue-500', sortOrder: 0, archivedAt: null, userId: MOCK_USER_ID },
  { id: 'list-personal', name: 'Personal', colorClass: 'bg-amber-500', sortOrder: 1, archivedAt: null, userId: MOCK_USER_ID },
  { id: 'list-health', name: 'Health', colorClass: 'bg-emerald-500', sortOrder: 2, archivedAt: null, userId: MOCK_USER_ID },
  { id: 'list-side-project', name: 'Side Project', colorClass: 'bg-purple-500', sortOrder: 3, archivedAt: null, userId: MOCK_USER_ID },
];

// ============================================
// Items — Today view (overdue + today + this week + done)
// ============================================

export const mockItems: MockItem[] = [
  // Overdue
  {
    id: 'item-overdue-1', type: 'task', status: 'active', title: 'Send invoice to Acme Corp',
    description: 'Q1 consulting invoice — 45 hours at agreed rate', notes: 'Check Harvest for exact hours',
    dueDate: yesterday.toISOString(), completedAt: null, reminder: 'morning_of', recurrence: null, recurrenceRule: null,
    contentType: null, contentDomain: null, contentDescription: null,
    listId: 'list-work', userId: MOCK_USER_ID, createdAt: yesterday.toISOString(), updatedAt: yesterday.toISOString(),
    urgency: 'overdue',
  },
  {
    id: 'item-overdue-2', type: 'task', status: 'active', title: 'Reply to Sarah about Q2 timeline',
    description: null, notes: null,
    dueDate: yesterday.toISOString(), completedAt: null, reminder: null, recurrence: null, recurrenceRule: null,
    contentType: null, contentDomain: null, contentDescription: null,
    listId: 'list-work', userId: MOCK_USER_ID, createdAt: yesterday.toISOString(), updatedAt: yesterday.toISOString(),
    urgency: 'overdue',
  },
  // Today
  {
    id: 'item-today-1', type: 'task', status: 'active', title: 'Review PR #142 — auth refactor',
    description: 'Mike\'s PR, touches the JWT flow', notes: 'Check the cookie handling on line 89',
    dueDate: today.toISOString(), completedAt: null, reminder: null, recurrence: null, recurrenceRule: null,
    contentType: null, contentDomain: null, contentDescription: null,
    listId: 'list-work', userId: MOCK_USER_ID, createdAt: today.toISOString(), updatedAt: today.toISOString(),
    urgency: 'today',
  },
  {
    id: 'item-today-2', type: 'task', status: 'active', title: 'Pick up dry cleaning',
    description: null, notes: 'Ticket #4821 on the counter. Ask about the stain on the blue shirt.',
    dueDate: today.toISOString(), completedAt: null, reminder: '1_hour_before', recurrence: null, recurrenceRule: null,
    contentType: null, contentDomain: null, contentDescription: null,
    listId: 'list-personal', userId: MOCK_USER_ID, createdAt: today.toISOString(), updatedAt: today.toISOString(),
    urgency: 'today',
  },
  {
    id: 'item-today-3', type: 'task', status: 'active', title: 'Book flights for Denver trip',
    description: 'April 18–22, check Southwest and United', notes: null,
    dueDate: today.toISOString(), completedAt: null, reminder: null, recurrence: null, recurrenceRule: null,
    contentType: null, contentDomain: null, contentDescription: null,
    listId: 'list-personal', userId: MOCK_USER_ID, createdAt: today.toISOString(), updatedAt: today.toISOString(),
    urgency: 'today',
  },
  {
    id: 'item-today-4', type: 'task', status: 'active', title: 'Run 5k',
    description: null, notes: 'Easy pace, recovery day',
    dueDate: today.toISOString(), completedAt: null, reminder: 'morning_of', recurrence: 'daily', recurrenceRule: 'FREQ=DAILY',
    contentType: null, contentDomain: null, contentDescription: null,
    listId: 'list-health', userId: MOCK_USER_ID, createdAt: today.toISOString(), updatedAt: today.toISOString(),
    urgency: 'today',
  },
  // This Week
  {
    id: 'item-week-1', type: 'task', status: 'active', title: 'Prepare board deck slides',
    description: 'Q2 strategy + metrics review', notes: null,
    dueDate: tomorrow.toISOString(), completedAt: null, reminder: 'day_before', recurrence: null, recurrenceRule: null,
    contentType: null, contentDomain: null, contentDescription: null,
    listId: 'list-work', userId: MOCK_USER_ID, createdAt: today.toISOString(), updatedAt: today.toISOString(),
    urgency: 'this_week',
  },
  {
    id: 'item-week-2', type: 'task', status: 'active', title: 'Dentist appointment',
    description: null, notes: 'Dr. Chen, 2pm',
    dueDate: dayAfterTomorrow.toISOString(), completedAt: null, reminder: '1_hour_before', recurrence: null, recurrenceRule: null,
    contentType: null, contentDomain: null, contentDescription: null,
    listId: 'list-health', userId: MOCK_USER_ID, createdAt: today.toISOString(), updatedAt: today.toISOString(),
    urgency: 'this_week',
  },
  // Done Today
  {
    id: 'item-done-1', type: 'task', status: 'done', title: 'Morning standup notes',
    description: null, notes: null,
    dueDate: today.toISOString(), completedAt: todayAt(9, 15),
    reminder: null, recurrence: null, recurrenceRule: null,
    contentType: null, contentDomain: null, contentDescription: null,
    listId: 'list-work', userId: MOCK_USER_ID, createdAt: today.toISOString(), updatedAt: todayAt(9, 15),
    urgency: 'today',
  },
  {
    id: 'item-done-2', type: 'task', status: 'done', title: 'Order new standing desk mat',
    description: null, notes: null,
    dueDate: today.toISOString(), completedAt: todayAt(8, 30),
    reminder: null, recurrence: null, recurrenceRule: null,
    contentType: null, contentDomain: null, contentDescription: null,
    listId: 'list-personal', userId: MOCK_USER_ID, createdAt: today.toISOString(), updatedAt: todayAt(8, 30),
    urgency: 'today',
  },
  {
    id: 'item-done-3', type: 'task', status: 'done', title: 'Review expense report',
    description: null, notes: null,
    dueDate: today.toISOString(), completedAt: todayAt(10, 0),
    reminder: null, recurrence: null, recurrenceRule: null,
    contentType: null, contentDomain: null, contentDescription: null,
    listId: 'list-work', userId: MOCK_USER_ID, createdAt: today.toISOString(), updatedAt: todayAt(10, 0),
    urgency: 'today',
  },

  // Inbox items (no dueDate, no urgency)
  {
    id: 'item-inbox-1', type: 'task', status: 'active', title: 'Call dentist about appointment',
    description: null, notes: null,
    dueDate: null, completedAt: null, reminder: null, recurrence: null, recurrenceRule: null,
    contentType: null, contentDomain: null, contentDescription: null,
    listId: null, userId: MOCK_USER_ID, createdAt: todayAt(8, 0), updatedAt: todayAt(8, 0),
    urgency: null,
  },
  {
    id: 'item-inbox-2', type: 'task', status: 'active', title: 'Research standing desks',
    description: null, notes: null,
    dueDate: null, completedAt: null, reminder: null, recurrence: null, recurrenceRule: null,
    contentType: null, contentDomain: null, contentDescription: null,
    listId: null, userId: MOCK_USER_ID, createdAt: yesterday.toISOString(), updatedAt: yesterday.toISOString(),
    urgency: null,
  },
  {
    id: 'item-inbox-3', type: 'content', status: 'active', title: 'Dense Discovery #287',
    description: null, notes: null,
    dueDate: null, completedAt: null, reminder: null, recurrence: null, recurrenceRule: null,
    contentType: 'web_page', contentDomain: 'densediscovery.com', contentDescription: 'Weekly design + tech newsletter',
    listId: null, userId: MOCK_USER_ID, createdAt: todayAt(7, 0), updatedAt: todayAt(7, 0),
    urgency: null,
  },
  {
    id: 'item-inbox-4', type: 'task', status: 'active', title: 'Buy new headphone tips',
    description: null, notes: 'Comply foam tips, medium',
    dueDate: null, completedAt: null, reminder: null, recurrence: null, recurrenceRule: null,
    contentType: null, contentDomain: null, contentDescription: null,
    listId: null, userId: MOCK_USER_ID, createdAt: yesterday.toISOString(), updatedAt: yesterday.toISOString(),
    urgency: null,
  },
  {
    id: 'item-inbox-5', type: 'content', status: 'active', title: 'Stratechery: Apple\'s AI Play',
    description: null, notes: null,
    dueDate: null, completedAt: null, reminder: null, recurrence: null, recurrenceRule: null,
    contentType: 'article', contentDomain: 'stratechery.com', contentDescription: 'Ben Thompson analysis on Apple Intelligence direction',
    listId: null, userId: MOCK_USER_ID, createdAt: yesterday.toISOString(), updatedAt: yesterday.toISOString(),
    urgency: null,
  },
  {
    id: 'item-inbox-6', type: 'task', status: 'active', title: 'Look into new React patterns',
    description: null, notes: null,
    dueDate: null, completedAt: null, reminder: null, recurrence: null, recurrenceRule: null,
    contentType: null, contentDomain: null, contentDescription: null,
    listId: null, userId: MOCK_USER_ID,
    createdAt: new Date(today.getTime() - 2 * 86400000).toISOString(),
    updatedAt: new Date(today.getTime() - 2 * 86400000).toISOString(),
    urgency: null,
  },

  // Upcoming items (future dates)
  {
    id: 'item-upcoming-1', type: 'task', status: 'active', title: 'Submit tax documents',
    description: null, notes: 'CPA needs by the 15th',
    dueDate: threeDaysOut.toISOString(), completedAt: null, reminder: 'day_before', recurrence: null, recurrenceRule: null,
    contentType: null, contentDomain: null, contentDescription: null,
    listId: 'list-personal', userId: MOCK_USER_ID, createdAt: today.toISOString(), updatedAt: today.toISOString(),
    urgency: null,
  },
  {
    id: 'item-upcoming-2', type: 'task', status: 'active', title: 'Plan team offsite agenda',
    description: 'Two-day offsite in May', notes: null,
    dueDate: fourDaysOut.toISOString(), completedAt: null, reminder: null, recurrence: null, recurrenceRule: null,
    contentType: null, contentDomain: null, contentDescription: null,
    listId: 'list-work', userId: MOCK_USER_ID, createdAt: today.toISOString(), updatedAt: today.toISOString(),
    urgency: null,
  },
  {
    id: 'item-upcoming-3', type: 'task', status: 'active', title: 'Renew gym membership',
    description: null, notes: null,
    dueDate: fiveDaysOut.toISOString(), completedAt: null, reminder: null, recurrence: null, recurrenceRule: null,
    contentType: null, contentDomain: null, contentDescription: null,
    listId: 'list-health', userId: MOCK_USER_ID, createdAt: today.toISOString(), updatedAt: today.toISOString(),
    urgency: null,
  },
];

// ============================================
// Calendar Events (today)
// ============================================

export const mockCalendarEvents: MockCalendarEvent[] = [
  {
    id: 'event-1', title: 'Q2 Review with Sarah',
    startTime: todayAt(10, 0), endTime: todayAt(11, 0),
    location: null, meetingLink: 'https://zoom.us/j/123456',
    attendees: ['Sarah Chen', 'Mike Rivera'],
    description: 'Review Q2 metrics and strategy alignment',
    isAllDay: false, calendarColor: '#E8B931',
  },
  {
    id: 'event-2', title: 'Design Sync',
    startTime: todayAt(11, 0), endTime: todayAt(11, 30),
    location: 'Room 3B', meetingLink: null,
    attendees: ['Alex Kim', 'Jordan Lee'],
    description: 'Weekly design review — mobile mockups',
    isAllDay: false, calendarColor: '#48BBA0',
  },
  {
    id: 'event-3', title: '1:1 with Manager',
    startTime: todayAt(14, 0), endTime: todayAt(14, 45),
    location: null, meetingLink: 'https://meet.google.com/abc-defg-hij',
    attendees: ['Pat Morgan'],
    description: null,
    isAllDay: false, calendarColor: '#E8B931',
  },
];

// ============================================
// Scouts
// ============================================

export const mockScouts: MockScout[] = [
  {
    id: 'scout-1', name: 'AI Competitor Watch',
    goal: 'Track product launches and funding rounds from AI productivity startups',
    status: 'active', lastFindingAt: todayAt(6, 30), findingCount: 23,
    sources: ['TechCrunch', 'Hacker News', 'Product Hunt'],
  },
  {
    id: 'scout-2', name: 'React Native Updates',
    goal: 'Monitor React Native ecosystem for breaking changes, new libraries, and Expo updates',
    status: 'active', lastFindingAt: yesterday.toISOString(), findingCount: 47,
    sources: ['GitHub', 'Expo Blog', 'Reddit r/reactnative'],
  },
  {
    id: 'scout-3', name: 'Standing Desk Deals',
    goal: 'Find deals on adjustable standing desks under $800 with good reviews',
    status: 'paused', lastFindingAt: null, findingCount: 3,
    sources: ['Wirecutter', 'Reddit r/standingdesks', 'Slickdeals'],
  },
];

export const mockScoutFindings: MockScoutFinding[] = [
  {
    id: 'finding-1', scoutId: 'scout-1', type: 'insight',
    title: 'Linear raised $50M Series C',
    summary: 'Linear closed a $50M round led by Benchmark, valuing the company at $1.5B. They\'re expanding into AI-powered project management.',
    relevanceScore: 0.92, reasoning: 'Direct competitor in productivity space, AI focus aligns with Brett\'s direction',
    sourceUrl: 'https://techcrunch.com/2026/04/linear-series-c',
    createdAt: todayAt(6, 30),
  },
  {
    id: 'finding-2', scoutId: 'scout-1', type: 'article',
    title: 'The AI Productivity Stack in 2026',
    summary: 'Overview of how AI is reshaping personal productivity tools. Mentions task management, calendar, and note-taking categories.',
    relevanceScore: 0.78, reasoning: 'Market landscape analysis relevant to positioning',
    sourceUrl: 'https://every.to/chain-of-thought/ai-productivity-2026',
    createdAt: yesterday.toISOString(),
  },
  {
    id: 'finding-3', scoutId: 'scout-2', type: 'insight',
    title: 'Expo SDK 56 Beta: New Architecture Default',
    summary: 'Expo SDK 56 will default to New Architecture for all new projects. Existing projects can opt-in.',
    relevanceScore: 0.95, reasoning: 'Directly affects our mobile build pipeline',
    sourceUrl: 'https://blog.expo.dev/sdk-56-beta',
    createdAt: yesterday.toISOString(),
  },
];

// ============================================
// Daily Briefing
// ============================================

export const mockBriefing = {
  content: `Busy morning — **Q2 Review** at 10, then **Design Sync** back-to-back until 11:30. Afternoon is clear for deep work after your **1:1 with Pat** at 2.\n\n2 items from yesterday still need attention: the **Acme invoice** and **Sarah's email** about Q2 timeline.\n\nYou're 3 of 12 tasks done today. The **Denver flights** are probably worth knocking out before prices move.`,
  generatedAt: todayAt(7, 0),
};

// ============================================
// Subtasks for task detail view
// ============================================

export const mockSubtasks: Record<string, Array<{ id: string; title: string; done: boolean }>> = {
  'item-today-2': [
    { id: 'sub-1', title: 'Drop off shirts', done: true },
    { id: 'sub-2', title: 'Pick up finished items', done: false },
    { id: 'sub-3', title: 'Ask about blue shirt stain', done: false },
  ],
  'item-today-1': [
    { id: 'sub-4', title: 'Check JWT cookie handling', done: false },
    { id: 'sub-5', title: 'Review test coverage', done: false },
    { id: 'sub-6', title: 'Approve or request changes', done: false },
  ],
};

// ============================================
// Helper — get list name for an item
// ============================================

export function getListForItem(item: MockItem): MockList | undefined {
  return mockLists.find((l) => l.id === item.listId);
}
```

- [ ] **Step 2: Create mock hooks matching real interface**

```typescript
// apps/mobile/src/mock/hooks.ts

import { useState, useCallback, useMemo } from 'react';
import {
  mockItems, mockLists, mockCalendarEvents, mockScouts, mockScoutFindings,
  mockBriefing, mockSubtasks, getListForItem,
  type MockItem, type MockList, type MockCalendarEvent, type MockScout, type MockScoutFinding,
} from './data';

// ============================================
// useItems — mock version
// ============================================

export function useMockItems() {
  const [items, setItems] = useState<MockItem[]>(mockItems);

  const todayItems = useMemo(() => {
    const active = items.filter((i) => i.urgency && i.status === 'active');
    const done = items.filter((i) => i.urgency && i.status === 'done');
    return [...active, ...done];
  }, [items]);

  const inboxItems = useMemo(() =>
    items.filter((i) => !i.dueDate && !i.listId && i.status === 'active'),
  [items]);

  const upcomingItems = useMemo(() =>
    items.filter((i) => i.dueDate && !i.urgency && i.status === 'active')
      .sort((a, b) => (a.dueDate! > b.dueDate! ? 1 : -1)),
  [items]);

  const getListItems = useCallback((listId: string) =>
    items.filter((i) => i.listId === listId && i.status === 'active'),
  [items]);

  const toggleItem = useCallback((id: string) => {
    setItems((prev) => prev.map((item) => {
      if (item.id !== id) return item;
      return {
        ...item,
        status: item.status === 'done' ? 'active' : 'done',
        completedAt: item.status === 'done' ? null : new Date().toISOString(),
      } as MockItem;
    }));
  }, []);

  const createItem = useCallback((title: string, dueDate: string | null, listId: string | null) => {
    const newItem: MockItem = {
      id: `item-new-${Date.now()}`, type: 'task', status: 'active', title,
      description: null, notes: null, dueDate, completedAt: null,
      reminder: null, recurrence: null, recurrenceRule: null,
      contentType: null, contentDomain: null, contentDescription: null,
      listId, userId: 'mock-user-001',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      urgency: dueDate ? 'today' : null,
    };
    setItems((prev) => [newItem, ...prev]);
    return newItem.id;
  }, []);

  const deleteItem = useCallback((id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  }, []);

  return {
    items, todayItems, inboxItems, upcomingItems, getListItems,
    getItem: (id: string) => items.find((i) => i.id === id),
    toggleItem, createItem, deleteItem,
  };
}

// ============================================
// useLists — mock version
// ============================================

export function useMockLists() {
  const [lists] = useState<MockList[]>(mockLists);

  const navLists = useMemo(() =>
    lists.filter((l) => !l.archivedAt).map((l) => ({
      ...l,
      count: mockItems.filter((i) => i.listId === l.id && i.status === 'active').length,
      completedCount: mockItems.filter((i) => i.listId === l.id && i.status === 'done').length,
    })),
  [lists]);

  return {
    lists,
    navLists,
    getList: (id: string) => lists.find((l) => l.id === id),
  };
}

// ============================================
// useCalendarEvents — mock version
// ============================================

export function useMockCalendarEvents() {
  const events = mockCalendarEvents;

  const nextEvent = useMemo(() => {
    const now = new Date();
    return events
      .filter((e) => !e.isAllDay && new Date(e.endTime) > now)
      .sort((a, b) => (a.startTime > b.startTime ? 1 : -1))[0] ?? null;
  }, []);

  const todayEvents = useMemo(() =>
    events.filter((e) => !e.isAllDay),
  []);

  // Meeting stats for header
  const meetingStats = useMemo(() => {
    const nonAllDay = events.filter((e) => !e.isAllDay);
    const totalMinutes = nonAllDay.reduce((sum, e) => {
      const start = new Date(e.startTime).getTime();
      const end = new Date(e.endTime).getTime();
      return sum + (end - start) / 60000;
    }, 0);
    const hours = Math.floor(totalMinutes / 60);
    const mins = Math.round(totalMinutes % 60);
    return {
      count: nonAllDay.length,
      duration: mins > 0 ? `${hours}h ${mins}m` : `${hours}h`,
    };
  }, []);

  return { events, nextEvent, todayEvents, meetingStats };
}

// ============================================
// useScouts — mock version
// ============================================

export function useMockScouts() {
  return {
    scouts: mockScouts,
    getScout: (id: string) => mockScouts.find((s) => s.id === id),
    getFindings: (scoutId: string) => mockScoutFindings.filter((f) => f.scoutId === scoutId),
  };
}

// ============================================
// useBriefing — mock version
// ============================================

export function useMockBriefing() {
  const [dismissed, setDismissed] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  return {
    content: mockBriefing.content,
    generatedAt: mockBriefing.generatedAt,
    isGenerating: false,
    isDismissed: dismissed,
    isCollapsed: collapsed,
    dismiss: () => setDismissed(true),
    toggleCollapse: () => setCollapsed((prev) => !prev),
  };
}

// ============================================
// useSubtasks — mock version
// ============================================

export function useMockSubtasks(itemId: string) {
  const [subtasks, setSubtasks] = useState(mockSubtasks[itemId] ?? []);

  const toggleSubtask = useCallback((subId: string) => {
    setSubtasks((prev) => prev.map((s) =>
      s.id === subId ? { ...s, done: !s.done } : s
    ));
  }, []);

  return { subtasks, toggleSubtask };
}

// ============================================
// Today stats — computed
// ============================================

export function useTodayStats() {
  // This would be derived from useMockItems in real usage,
  // but we compute from raw data for simplicity
  const totalToday = mockItems.filter((i) => i.urgency).length;
  const doneToday = mockItems.filter((i) => i.urgency && i.status === 'done').length;
  const { count: meetingCount, duration: meetingDuration } = useMockCalendarEvents().meetingStats;

  return { totalToday, doneToday, meetingCount, meetingDuration };
}

export { getListForItem };
```

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/src/mock/ && git commit -m "feat(mobile): add mock data layer with realistic items, events, scouts, briefing"
```

---

## Task 3: Living Background & Glass Card

**Files:**
- Create: `apps/mobile/src/components/LivingBackground.tsx`
- Create: `apps/mobile/src/components/GlassCard.tsx`
- Create: `apps/mobile/src/hooks/use-reduce-motion.ts`

- [ ] **Step 1: Create reduce-motion accessibility hook**

```typescript
// apps/mobile/src/hooks/use-reduce-motion.ts

import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

export function useReduceMotion(): boolean {
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => sub.remove();
  }, []);

  return reduceMotion;
}
```

- [ ] **Step 2: Create LivingBackground component**

For the prototype, use a gradient that shifts with time-of-day segments as a placeholder for the full image system. This lets us validate the glass surfaces and vignette without needing Railway storage.

```typescript
// apps/mobile/src/components/LivingBackground.tsx

import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

type TimeSegment = 'dawn' | 'morning' | 'afternoon' | 'golden_hour' | 'evening' | 'night';

const segmentGradients: Record<TimeSegment, [string, string, string]> = {
  dawn:         ['#1a0a2e', '#2d1b4e', '#4a2c6e'],
  morning:      ['#0c1220', '#1a2840', '#2a4060'],
  afternoon:    ['#0f1a2e', '#1e3050', '#2e4668'],
  golden_hour:  ['#1a1005', '#2e1f0a', '#4a3010'],
  evening:      ['#0a0e1a', '#141e30', '#1c2a42'],
  night:        ['#050508', '#0a0c14', '#0f1220'],
};

function getTimeSegment(): TimeSegment {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 7) return 'dawn';
  if (hour >= 7 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 19) return 'golden_hour';
  if (hour >= 19 && hour < 21) return 'evening';
  return 'night';
}

export function LivingBackground() {
  const segment = useMemo(() => getTimeSegment(), []);
  const gradientColors = segmentGradients[segment];

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <LinearGradient
        colors={gradientColors}
        locations={[0, 0.5, 1]}
        start={{ x: 0.2, y: 0 }}
        end={{ x: 0.8, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      {/* Top vignette for status bar readability */}
      <LinearGradient
        colors={['rgba(0,0,0,0.5)', 'transparent']}
        locations={[0, 1]}
        style={[StyleSheet.absoluteFill, { height: 120 }]}
      />
      {/* Bottom vignette for tab bar readability */}
      <LinearGradient
        colors={['transparent', 'rgba(0,0,0,0.6)']}
        locations={[0, 1]}
        style={[StyleSheet.absoluteFill, { top: '70%' }]}
      />
    </View>
  );
}
```

- [ ] **Step 3: Create GlassCard component**

```typescript
// apps/mobile/src/components/GlassCard.tsx

import React from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';
import { colors, radii } from '../theme/tokens';

interface GlassCardProps {
  children: React.ReactNode;
  variant?: 'primary' | 'light' | 'elevated' | 'heavy';
  style?: ViewStyle;
}

const intensityMap = {
  primary: 40,
  light: 30,
  elevated: 50,
  heavy: 60,
} as const;

const backgroundMap = {
  primary: colors.glassPrimary,
  light: colors.glassLight,
  elevated: colors.glassElevated,
  heavy: colors.glassHeavy,
} as const;

export function GlassCard({ children, variant = 'primary', style }: GlassCardProps) {
  return (
    <View style={[styles.container, { borderRadius: radii.card }, style]}>
      <BlurView
        intensity={intensityMap[variant]}
        tint="dark"
        style={StyleSheet.absoluteFill}
      />
      <View style={[styles.overlay, { backgroundColor: backgroundMap[variant] }]} />
      <View style={styles.content}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
  },
  content: {
    position: 'relative',
  },
});
```

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/components/LivingBackground.tsx apps/mobile/src/components/GlassCard.tsx apps/mobile/src/hooks/use-reduce-motion.ts && git commit -m "feat(mobile): add living background, glass card, and reduce-motion hook"
```

---

## Task 4: Core UI Components (TaskRow, SectionHeader, HeaderStats, EmptyState)

**Files:**
- Create: `apps/mobile/src/components/TaskRow.tsx`
- Create: `apps/mobile/src/components/SectionHeader.tsx`
- Create: `apps/mobile/src/components/HeaderStats.tsx`
- Create: `apps/mobile/src/components/EmptyState.tsx`

These are the building blocks every list screen uses. Build them against mock data, verifiable on screen.

- [ ] **Step 1: Create SectionHeader**

```typescript
// apps/mobile/src/components/SectionHeader.tsx

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, typography, spacing } from '../theme/tokens';

interface SectionHeaderProps {
  label: string;
  variant?: 'default' | 'overdue' | 'gold' | 'done';
}

export function SectionHeader({ label, variant = 'default' }: SectionHeaderProps) {
  const labelColor =
    variant === 'overdue' ? 'rgba(230, 85, 75, 0.6)' :
    variant === 'gold' ? 'rgba(232, 185, 49, 0.5)' :
    variant === 'done' ? 'rgba(255, 255, 255, 0.15)' :
    colors.textTertiary;

  return (
    <View style={styles.container}>
      <Text style={[styles.label, { color: labelColor }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: spacing.xs,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  label: {
    ...typography.sectionLabel,
  },
});
```

- [ ] **Step 2: Create TaskRow with checkbox animation**

Build the TaskRow component with:
- Tap checkbox → gold fill animation + success haptic
- Tap row body → navigation callback (for push to detail)
- Gold checkbox border, list name in gold, metadata line
- Overdue variant with red left border

Use `react-native-reanimated` for the checkbox fill animation. Use `Pressable` for tap targets (not `TouchableOpacity` — it doesn't support the 44pt minimum tap target pattern well).

The component should receive an `onToggle` callback and an `onPress` callback. It should NOT manage its own completion state — that's the parent's job via hooks.

Implementation: Create the file at `apps/mobile/src/components/TaskRow.tsx`. Include:
- Animated checkbox (shared value for fill progress, animated gold background)
- Title text with strikethrough + fade when done
- Metadata line: due time + list name (gold colored)
- Overdue left border (2px red)
- Minimum 44pt touch target on checkbox area

- [ ] **Step 3: Create HeaderStats**

```typescript
// apps/mobile/src/components/HeaderStats.tsx

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, typography, spacing } from '../theme/tokens';
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withTiming } from 'react-native-reanimated';

interface HeaderStatsProps {
  date: string; // formatted date string
  doneCount: number;
  totalCount: number;
  meetingCount: number;
  meetingDuration: string;
}

export function HeaderStats({ date, doneCount, totalCount, meetingCount, meetingDuration }: HeaderStatsProps) {
  const statsFlash = useSharedValue(0);

  // Call this when a task is completed to pulse gold
  // (parent will trigger via ref or effect on doneCount change)
  const animatedStatsStyle = useAnimatedStyle(() => ({
    color: statsFlash.value > 0
      ? `rgba(232, 185, 49, ${0.35 + statsFlash.value * 0.45})`
      : colors.textSecondary,
  }));

  // Pulse on doneCount change
  React.useEffect(() => {
    if (doneCount > 0) {
      statsFlash.value = withSequence(
        withTiming(1, { duration: 100 }),
        withTiming(0, { duration: 400 }),
      );
    }
  }, [doneCount]);

  const statsText = `${doneCount} of ${totalCount} done · ${meetingCount} meeting${meetingCount !== 1 ? 's' : ''} (${meetingDuration})`;

  return (
    <View style={styles.container}>
      <Text style={styles.date}>{date}</Text>
      <Animated.Text style={[styles.stats, animatedStatsStyle]}>
        {statsText}
      </Animated.Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.xs,
  },
  date: {
    ...typography.pageHeader,
    color: colors.textFull,
  },
  stats: {
    ...typography.metadata,
    marginTop: spacing.xs,
    color: colors.textSecondary,
  },
});
```

- [ ] **Step 4: Create EmptyState**

```typescript
// apps/mobile/src/components/EmptyState.tsx

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, typography, spacing } from '../theme/tokens';

type EmptyStateVariant =
  | 'all-done'
  | 'inbox-empty'
  | 'inbox-cleared'
  | 'upcoming-empty'
  | 'list-empty'
  | 'scouts-empty'
  | 'no-events';

const copy: Record<EmptyStateVariant, { heading: string; body: string }> = {
  'all-done': {
    heading: 'Cleared.',
    body: 'Nothing left. Go build something or enjoy the quiet.',
  },
  'inbox-empty': {
    heading: 'Your inbox',
    body: 'Everything worth doing starts here.',
  },
  'inbox-cleared': {
    heading: 'Cleared.',
    body: 'Nothing left. Go build something or enjoy the quiet.',
  },
  'upcoming-empty': {
    heading: 'Wide open',
    body: "Nothing scheduled ahead. That's either zen or an oversight.",
  },
  'list-empty': {
    heading: 'No tasks yet',
    body: 'Add one, or enjoy the emptiness.',
  },
  'scouts-empty': {
    heading: 'No scouts yet',
    body: 'Scouts monitor the internet for you. Create one to get started.',
  },
  'no-events': {
    heading: 'Nothing on the books today.',
    body: 'A rare opening — use it well.',
  },
};

interface EmptyStateProps {
  variant: EmptyStateVariant;
}

export function EmptyState({ variant }: EmptyStateProps) {
  const { heading, body } = copy[variant];

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>{heading}</Text>
      <Text style={styles.body}>{body}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.xxxl,
    paddingVertical: 80,
  },
  heading: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.textFull,
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
  body: {
    fontSize: 14,
    fontWeight: '400',
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
  },
});
```

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/components/ && git commit -m "feat(mobile): add TaskRow, SectionHeader, HeaderStats, EmptyState components"
```

---

## Task 5: Tab Navigation with Custom Tab Bar

**Files:**
- Create: `apps/mobile/src/components/TabBar.tsx`
- Create: `apps/mobile/app/(app)/(tabs)/_layout.tsx`
- Modify: `apps/mobile/app/(app)/_layout.tsx`
- Delete: `apps/mobile/app/(app)/today.tsx` (replaced by tabs version)

This is the structural change — converting from a single-screen stack to tab navigation with a stack wrapper for push screens.

- [ ] **Step 1: Create custom TabBar component**

Build the custom tab bar with:
- 4 tab buttons (Today, Inbox, Upcoming, Calendar) with Lucide icons
- Center oversized voice button with gold radial gradient + ambient glow pulse
- Gold sliding dot indicator between active tabs (spring animation)
- Inbox badge count with breathing animation when items present

The tab bar sits above a glass-blur background (`bg-black/50 backdrop-blur-xl`).

Implementation file: `apps/mobile/src/components/TabBar.tsx`

Key details:
- Accept Expo Router's `BottomTabBarProps` to integrate with the tab layout
- Voice button in the center (index 2 in the layout, but it's a dummy route that triggers voice mode overlay instead of navigation)
- Use `useAnimatedStyle` for the sliding gold indicator position
- Use `useAnimatedStyle` for the voice button ambient glow (opacity oscillation, 4-5s cycle)
- Use `useAnimatedStyle` for inbox badge breathing (opacity 0.8 → 1.0, 2s cycle)

- [ ] **Step 2: Create tab layout**

```typescript
// apps/mobile/app/(app)/(tabs)/_layout.tsx

import { Tabs } from 'expo-router';
import { TabBar } from '../../../src/components/TabBar';

export default function TabLayout() {
  return (
    <Tabs
      tabBar={(props) => <TabBar {...props} />}
      screenOptions={{
        headerShown: false,
      }}
    >
      <Tabs.Screen name="today" options={{ title: 'Today' }} />
      <Tabs.Screen name="inbox" options={{ title: 'Inbox' }} />
      <Tabs.Screen
        name="voice"
        options={{ title: 'Voice' }}
        listeners={{ tabPress: (e) => e.preventDefault() }}
      />
      <Tabs.Screen name="upcoming" options={{ title: 'Upcoming' }} />
      <Tabs.Screen name="calendar" options={{ title: 'Calendar' }} />
    </Tabs>
  );
}
```

Create a placeholder `apps/mobile/app/(app)/(tabs)/voice.tsx` that just returns `null` (the voice tab doesn't navigate — it triggers voice mode).

- [ ] **Step 3: Update app stack layout to wrap tabs + push screens**

```typescript
// apps/mobile/app/(app)/_layout.tsx

import { Stack } from 'expo-router';

export default function AppLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="task/[id]" options={{ animation: 'slide_from_right' }} />
      <Stack.Screen name="list/[id]" options={{ animation: 'slide_from_right' }} />
      <Stack.Screen name="settings" options={{ animation: 'slide_from_right' }} />
      <Stack.Screen name="scouts/index" options={{ animation: 'slide_from_right' }} />
      <Stack.Screen name="scouts/[id]" options={{ animation: 'slide_from_right' }} />
      <Stack.Screen name="content/[id]" options={{ animation: 'slide_from_right' }} />
    </Stack>
  );
}
```

- [ ] **Step 4: Update root redirect**

Update `apps/mobile/app/index.tsx` to redirect to `/(app)/(tabs)/today` instead of `/(app)/today`.

- [ ] **Step 5: Create placeholder screens for all routes**

Create minimal placeholder screens for each route that just shows the screen name centered on screen with the LivingBackground behind it. These will be built out in subsequent tasks:

- `apps/mobile/app/(app)/(tabs)/today.tsx`
- `apps/mobile/app/(app)/(tabs)/inbox.tsx`
- `apps/mobile/app/(app)/(tabs)/voice.tsx`
- `apps/mobile/app/(app)/(tabs)/upcoming.tsx`
- `apps/mobile/app/(app)/(tabs)/calendar.tsx`
- `apps/mobile/app/(app)/task/[id].tsx`
- `apps/mobile/app/(app)/list/[id].tsx`
- `apps/mobile/app/(app)/settings.tsx`
- `apps/mobile/app/(app)/scouts/index.tsx`
- `apps/mobile/app/(app)/scouts/[id].tsx`
- `apps/mobile/app/(app)/content/[id].tsx`

Each placeholder should import `LivingBackground` and render it behind a centered `Text` with the route name. This verifies routing works before we build real screens.

- [ ] **Step 6: Delete old today.tsx**

Remove the old `apps/mobile/app/(app)/today.tsx` (the single-screen version). It's replaced by the tabs version.

- [ ] **Step 7: Verify on Simulator**

```bash
cd apps/mobile && npx expo start --ios
```

Verify: tab bar appears with all 4 tabs + center voice button. Tapping tabs switches screens. Voice button doesn't navigate. Push routes are accessible (test by manually navigating in code).

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat(mobile): tab navigation with custom tab bar, voice button, and route structure"
```

---

## Task 6: Omnibar & Daily Briefing Components

**Files:**
- Create: `apps/mobile/src/components/Omnibar.tsx`
- Create: `apps/mobile/src/components/DailyBriefing.tsx`
- Create: `apps/mobile/src/components/NextUpCard.tsx`

- [ ] **Step 1: Create Omnibar**

Pinned above tab bar. Single-line input that expands on focus. Features:
- "Add a task..." placeholder (or "Capture something..." on Inbox)
- Small gold dot on right edge
- On focus: keyboard rises, omnibar stays above keyboard
- On submit (return key): calls `onSubmit(text)`, haptic light, clears input
- Brief gold flash on border after submit (animated border color)

Implementation: `apps/mobile/src/components/Omnibar.tsx`

Props: `{ placeholder?: string; onSubmit: (text: string) => void }`

Use `KeyboardAvoidingView` or `useKeyboardHandler` from reanimated to keep the omnibar above the keyboard. Use a shared value for the gold border flash animation (0 → 1 → 0 over 300ms on submit).

- [ ] **Step 2: Create DailyBriefing**

Collapsible, dismissible briefing card with Brett's personality:
- Cerulean-tinted GlassCard
- "Daily Briefing" label in cerulean uppercase
- Briefing text (supports **bold** rendering)
- Collapse toggle: tap header to collapse/expand with height animation
- Dismiss: (for now, just a close button — swipe-to-dismiss can be added during polish)

Implementation: `apps/mobile/src/components/DailyBriefing.tsx`

Props from `useMockBriefing()`: `{ content, isCollapsed, isDismissed, toggleCollapse, dismiss, generatedAt }`

Use `useAnimatedStyle` + `withTiming` for the collapse height animation (250ms ease-out). When collapsed, show single line: "Daily Briefing ▸". When dismissed, render nothing.

- [ ] **Step 3: Create NextUpCard**

Compact card showing next calendar event:
- Gold-tinted border
- Time until event (computed from mock startTime)
- Event title, location/meeting link, duration
- Tap callback for navigation to event detail

Implementation: `apps/mobile/src/components/NextUpCard.tsx`

Props: `{ event: MockCalendarEvent; onPress: () => void }`

Compute time-until from `event.startTime`. Show "In Xm" or "In Xh Ym" or "Now" if event is happening. Border color shifts from gold to amber when ≤10 minutes away.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/components/Omnibar.tsx apps/mobile/src/components/DailyBriefing.tsx apps/mobile/src/components/NextUpCard.tsx && git commit -m "feat(mobile): add Omnibar, DailyBriefing, and NextUpCard components"
```

---

## Task 7: Today Screen (Full Composition)

**Files:**
- Modify: `apps/mobile/app/(app)/(tabs)/today.tsx`

- [ ] **Step 1: Build Today screen**

Compose all components into the Today screen following the spec layout:

1. `LivingBackground` (absolute, behind everything)
2. `SafeAreaView` wrapping content
3. `HeaderStats` — date + "X of Y done · Z meetings (duration)"
4. `DailyBriefing` — collapsible, dismissible (from `useMockBriefing`)
5. `NextUpCard` — next event (from `useMockCalendarEvents`)
6. Scrollable task sections inside a glass card:
   - `SectionHeader` "Overdue" (if overdue items exist)
   - Overdue `TaskRow` items
   - `SectionHeader` "Today"
   - Today `TaskRow` items
   - `SectionHeader` "This Week"
   - This-week `TaskRow` items
   - `SectionHeader` "Done Today" (faded)
   - Done `TaskRow` items (faded, strikethrough)
7. `Omnibar` pinned at bottom above tab bar

Use `useMockItems()`, `useMockCalendarEvents()`, `useMockBriefing()`, `useTodayStats()` for data.

Group items by urgency for sections. Filter done items separately.

`TaskRow` `onToggle` calls `toggleItem(id)`. `TaskRow` `onPress` calls `router.push(`/task/${id}`)`.

Use `FlatList` with `SectionList`-style rendering (or just use `SectionList`) for the task sections. The omnibar should NOT scroll — it's pinned. Use absolute positioning or a flex layout where the list is in a flex-1 area and the omnibar is below it.

- [ ] **Step 2: Verify on Simulator**

Open the app. Today screen should show:
- Header with date, progress, meeting stats
- Briefing card (collapsible)
- Next up event card
- Overdue, Today, This Week, Done sections with task rows
- Omnibar at bottom
- All over the living background with glass cards

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/app/(app)/(tabs)/today.tsx && git commit -m "feat(mobile): build Today screen with all sections and mock data"
```

---

## Task 8: Inbox Screen

**Files:**
- Modify: `apps/mobile/app/(app)/(tabs)/inbox.tsx`

- [ ] **Step 1: Build Inbox screen**

Flat list of unsorted items — no urgency grouping. Layout:

1. `LivingBackground`
2. Header: "Inbox" (page header) + item count
3. Flat list of `TaskRow` items (inbox items from mock data)
   - Content items (newsletters, articles) get a cerulean left border and content-type indicator
   - Tasks get the standard gold checkbox
4. `Omnibar` with placeholder "Capture something..."
5. Empty state: `EmptyState variant="inbox-empty"` when no items

Content items need a slightly different `TaskRow` variant — pass a `contentType` prop that renders a small content indicator icon instead of a checkbox, and shows the domain as metadata.

- [ ] **Step 2: Commit**

```bash
git add apps/mobile/app/(app)/(tabs)/inbox.tsx && git commit -m "feat(mobile): build Inbox screen with content items and empty state"
```

---

## Task 9: Upcoming Screen

**Files:**
- Modify: `apps/mobile/app/(app)/(tabs)/upcoming.tsx`

- [ ] **Step 1: Build Upcoming screen**

Future tasks grouped by date. Layout:

1. `LivingBackground`
2. Header: "Upcoming" (page header)
3. `SectionList` grouped by date:
   - Section headers: "Tomorrow", "Wednesday, Apr 10", "Thursday, Apr 11", etc.
   - `TaskRow` items within each section
4. `Omnibar` with default placeholder
5. Empty state: `EmptyState variant="upcoming-empty"` when no items

Group `upcomingItems` from `useMockItems()` by date. Format section headers using date formatting (show day name for this week, full date for next week+).

- [ ] **Step 2: Commit**

```bash
git add apps/mobile/app/(app)/(tabs)/upcoming.tsx && git commit -m "feat(mobile): build Upcoming screen with date-grouped sections"
```

---

## Task 10: Calendar Screen

**Files:**
- Modify: `apps/mobile/app/(app)/(tabs)/calendar.tsx`
- Create: `apps/mobile/src/components/WeekStrip.tsx`
- Create: `apps/mobile/src/components/TimelineEvent.tsx`

- [ ] **Step 1: Create WeekStrip**

Horizontal week display:
- 7 day columns (Mon–Sun)
- Day label (M, T, W, etc.) + day number
- Current day: gold-filled circle
- Days with events: small dot below the number
- Tap a day: callback to scroll timeline
- Swipe to navigate weeks (for prototype: just show current week, static)

Implementation: `apps/mobile/src/components/WeekStrip.tsx`

- [ ] **Step 2: Create TimelineEvent**

Event block in the day timeline:
- Colored left border (2px, event's `calendarColor`)
- Title, location/meeting link, duration
- Tinted background matching the border color at low opacity
- Tap → callback for navigation

Implementation: `apps/mobile/src/components/TimelineEvent.tsx`

- [ ] **Step 3: Build Calendar screen**

Layout:
1. `LivingBackground`
2. Header: month/year
3. `WeekStrip`
4. Day timeline: `ScrollView` with hourly time slots (7 AM – 8 PM)
   - Each slot: time label on left (40px wide), event block or empty space on right
   - Events positioned at their start time, height proportional to duration
5. No omnibar on Calendar

Use `useMockCalendarEvents().todayEvents` for event data. Render time slots from 7 AM to 8 PM. Place events at the correct time positions.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/components/WeekStrip.tsx apps/mobile/src/components/TimelineEvent.tsx apps/mobile/app/(app)/(tabs)/calendar.tsx && git commit -m "feat(mobile): build Calendar screen with week strip and day timeline"
```

---

## Task 11: Task Detail Screen (Full-Screen Push)

**Files:**
- Modify: `apps/mobile/app/(app)/task/[id].tsx`

- [ ] **Step 1: Build Task Detail**

Full-screen push screen. Layout (vertical scroll):

1. `LivingBackground`
2. Back breadcrumb: "‹ Today" (or source screen name) in gold — `Pressable` that calls `router.back()`
3. Title row: large checkbox (24px) + task title (20px, weight 600)
4. Details card (`GlassCard`):
   - Due date row (tappable, shows current value)
   - List row (tappable, list name in gold)
   - Reminder row
   - Recurrence row
   - Each row: label left, value right, separated by subtle border
5. Notes card (`GlassCard`):
   - "Notes" section label
   - Note text (or "Add notes..." placeholder)
6. Subtasks card (`GlassCard`):
   - "Subtasks" section label
   - Subtask rows with mini gold checkboxes
   - "Add subtask..." input at bottom
   - Uses `useMockSubtasks(id)` for data
7. Brett chat card (`GlassCard` with cerulean tint):
   - Cerulean dot + "Ask Brett about this task..."
   - Tappable (no-op for prototype)

Get task data from `useMockItems().getItem(id)`. Get list from `useMockLists().getList(item.listId)`.

- [ ] **Step 2: Verify on Simulator**

Tap a task on Today → should push to detail. Swipe from left edge → should go back. Breadcrumb tap → should go back.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/app/(app)/task/ && git commit -m "feat(mobile): build Task Detail screen with all sections"
```

---

## Task 12: Settings Screen

**Files:**
- Modify: `apps/mobile/app/(app)/settings.tsx`

- [ ] **Step 1: Build Settings screen**

iOS grouped-inset list style. All sections present as labels (tappable rows that don't navigate for prototype, just show the section structure).

Layout:
1. `LivingBackground`
2. Header: "Settings" with back breadcrumb
3. Grouped sections in `GlassCard`:
   - **Profile**: Name, email, avatar placeholder
   - **Security**: Password, connected accounts (Google, Apple)
   - **Calendar**: Google Calendar connection status
   - **AI Providers**: Provider configuration
   - **Newsletters**: Ingest email, active subscriptions
   - **Timezone & Location**: Current timezone, weather toggle
   - **Import**: Import from other apps
   - **Updates**: App version
   - **Account**: Sign out (destructive red text)

Each group is a `GlassCard` with rows separated by subtle borders. Row: label left, value/chevron right.

- [ ] **Step 2: Commit**

```bash
git add apps/mobile/app/(app)/settings.tsx && git commit -m "feat(mobile): build Settings screen with iOS grouped-inset style"
```

---

## Task 13: List Detail, Scouts, and Content Screens

**Files:**
- Modify: `apps/mobile/app/(app)/list/[id].tsx`
- Modify: `apps/mobile/app/(app)/scouts/index.tsx`
- Modify: `apps/mobile/app/(app)/scouts/[id].tsx`
- Modify: `apps/mobile/app/(app)/content/[id].tsx`

- [ ] **Step 1: Build List Detail**

Same list component pattern as Today/Inbox but filtered to one list:
1. `LivingBackground`
2. Header: list name (from `useMockLists().getList(id)`) + back breadcrumb
3. `TaskRow` list of items in this list (from `useMockItems().getListItems(id)`)
4. Empty state: `EmptyState variant="list-empty"` when no items

- [ ] **Step 2: Build Scouts Roster**

Grid/list of scouts:
1. `LivingBackground`
2. Header: "Scouts" + back breadcrumb
3. Scout cards in `GlassCard` — for each scout:
   - Name (heading), goal (body, truncated to 2 lines)
   - Status pill: green/active, amber/paused, red/error
   - Finding count + last finding time
   - Tap → `router.push(`/scouts/${scout.id}`)`
4. Empty state: `EmptyState variant="scouts-empty"` when no scouts

Use `useMockScouts()` for data.

- [ ] **Step 3: Build Scout Detail**

Full-screen push:
1. `LivingBackground`
2. Back breadcrumb + scout name header
3. Goal card (`GlassCard`) — full goal text
4. Sources card — list of sources as pills/tags
5. Findings list — each finding in a `GlassCard`:
   - Type badge (insight/article/task)
   - Title + summary
   - Relevance score bar (gold fill, proportional to score)
   - Source URL if present

Use `useMockScouts().getFindings(id)` for findings data.

- [ ] **Step 4: Build Content Detail**

Clean reading view:
1. `LivingBackground`
2. Back breadcrumb
3. Content type label (newsletter, article, etc.) in cerulean uppercase
4. Title (large heading)
5. Source domain + metadata
6. Content body (or placeholder: "Content extraction not available in prototype")
7. "Save as task" button at bottom

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/app/(app)/list/ apps/mobile/app/(app)/scouts/ apps/mobile/app/(app)/content/ && git commit -m "feat(mobile): build List Detail, Scouts, and Content screens"
```

---

## Task 14: Swipe Gestures on Task Rows

**Files:**
- Modify: `apps/mobile/src/components/TaskRow.tsx`

- [ ] **Step 1: Add swipe-right for date picker**

Wrap the TaskRow in a `Swipeable` from `react-native-gesture-handler` (or use `react-native-reanimated` gesture handlers directly for more control over physics).

Swipe right reveals:
- Gold-tinted action area behind the row
- Calendar icon that scales up as you approach threshold (0.7x → 1.0x)
- Medium haptic at threshold
- Rubber-band resistance past threshold
- Color bleeds subtly into the row background

On trigger: call `onSchedule(id)` callback (no-op for prototype — just snap back with haptic).

- [ ] **Step 2: Add swipe-left for select**

Swipe left reveals:
- Cerulean-tinted action area
- Checkmark icon that scales to threshold
- On trigger: call `onSelect(id)` callback

For now, the select action adds/removes the item from a selection set. The parent manages selection state. When any item is selected, the `MultiSelectToolbar` appears at the bottom.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/src/components/TaskRow.tsx && git commit -m "feat(mobile): add swipe gestures to TaskRow (schedule right, select left)"
```

---

## Task 15: MultiSelect Toolbar & Batch Completion

**Files:**
- Create: `apps/mobile/src/components/MultiSelectToolbar.tsx`
- Create: `apps/mobile/src/hooks/use-batch-completion.ts`

- [ ] **Step 1: Create MultiSelectToolbar**

Bottom toolbar that slides up when items are selected:
- Glass elevated background
- Three action buttons: **Schedule** (gold icon), **Move to List** (blue icon), **Delete** (red icon)
- Selected count badge
- "Done" button to exit selection mode
- Slide-up animation (250ms spring)

Implementation: `apps/mobile/src/components/MultiSelectToolbar.tsx`

Props: `{ selectedCount: number; onSchedule: () => void; onMoveToList: () => void; onDelete: () => void; onDone: () => void; visible: boolean }`

Use `useAnimatedStyle` for the slide-up/down transform.

- [ ] **Step 2: Create batch completion hook**

```typescript
// apps/mobile/src/hooks/use-batch-completion.ts

import { useRef, useCallback } from 'react';

/**
 * Delays list reflow after rapid completions.
 * Returns a wrapper around toggleItem that batches visual updates.
 * The actual toggle happens immediately, but `shouldReflow` stays false
 * until 1.5 seconds of inactivity.
 */
export function useBatchCompletion(toggleItem: (id: string) => void) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [shouldReflow, setShouldReflow] = useState(true);

  const batchToggle = useCallback((id: string) => {
    toggleItem(id);
    setShouldReflow(false);

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setShouldReflow(true);
    }, 1500);
  }, [toggleItem]);

  return { batchToggle, shouldReflow };
}
```

This hook is used by Today/Inbox/Upcoming screens. When `shouldReflow` is false, completed items stay in place visually. When it becomes true, the list re-sorts/re-sections and completed items animate to the Done section.

- [ ] **Step 3: Integrate multiselect and batch completion into Today screen**

Add selection state management to Today screen:
- `selectedIds: Set<string>` state
- Pass `onSelect` to TaskRow components
- Show `MultiSelectToolbar` when `selectedIds.size > 0`
- Wire `useBatchCompletion` to the toggle flow

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/components/MultiSelectToolbar.tsx apps/mobile/src/hooks/use-batch-completion.ts apps/mobile/app/(app)/(tabs)/today.tsx && git commit -m "feat(mobile): add multiselect toolbar and batch completion hook"
```

---

## Task 16: Morning Ritual & Voice Mode

**Files:**
- Create: `apps/mobile/src/components/MorningRitual.tsx`
- Create: `apps/mobile/src/hooks/use-morning-ritual.ts`
- Create: `apps/mobile/src/components/VoiceMode.tsx`

- [ ] **Step 1: Create morning ritual hook**

```typescript
// apps/mobile/src/hooks/use-morning-ritual.ts

import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const MORNING_RITUAL_KEY = 'brett_morning_ritual_date';

export function useMorningRitual(): boolean {
  const [shouldAnimate, setShouldAnimate] = useState(false);

  useEffect(() => {
    (async () => {
      const today = new Date().toDateString();
      const lastDate = await AsyncStorage.getItem(MORNING_RITUAL_KEY);
      if (lastDate !== today) {
        setShouldAnimate(true);
        await AsyncStorage.setItem(MORNING_RITUAL_KEY, today);
      }
    })();
  }, []);

  return shouldAnimate;
}
```

Note: Will need to install `@react-native-async-storage/async-storage` (or use `expo-secure-store` for simplicity, but async-storage is lighter for non-sensitive data).

- [ ] **Step 2: Create MorningRitual wrapper**

Animated wrapper that staggers children on first open of day:
- Wraps the Today screen content
- Each child gets a delay (0ms, 200ms, 400ms, 600ms, 750ms)
- Animation: fade + slide-up (or just fade if Reduce Motion is on)
- After animation completes, becomes a plain passthrough

Implementation: `apps/mobile/src/components/MorningRitual.tsx`

Accepts children as an array. Wraps each in an `Animated.View` with staggered `useAnimatedStyle` — translateY starts at 20 and goes to 0, opacity starts at 0 and goes to 1, each with increasing delay.

If `useMorningRitual()` returns false, renders children immediately with no animation.
If `useReduceMotion()` returns true, uses a simple 300ms fade instead of staggered spring.

- [ ] **Step 3: Create VoiceMode overlay**

Full-screen overlay triggered by the center tab button:
- Heavy haptic on activate
- Gold pulse wave from center (radial, expanding)
- Tab bar dims (parent manages this via state)
- Background vignette deepens
- Gold waveform visualization (sine wave with random amplitude, just visual for prototype)
- "Listening..." label
- Tap anywhere to dismiss (reverse animation)

Implementation: `apps/mobile/src/components/VoiceMode.tsx`

This is a modal overlay. The TabBar component manages a `voiceModeActive` state. When the center button is pressed, it sets this state, which renders the VoiceMode overlay on top of everything.

For prototype: the waveform is decorative (animated sine waves in gold). No actual audio processing.

- [ ] **Step 4: Wire MorningRitual into Today screen**

Wrap the Today screen's content sections in `<MorningRitual>`.

- [ ] **Step 5: Wire VoiceMode into TabBar**

Add `voiceModeActive` state to the tab bar. When center button is pressed, show the VoiceMode overlay. VoiceMode's `onDismiss` sets the state back to false.

- [ ] **Step 6: Install async-storage**

```bash
cd apps/mobile && pnpm add @react-native-async-storage/async-storage
```

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat(mobile): add morning ritual animation and voice mode overlay"
```

---

## Task 17: Contextual Drawer

**Files:**
- Create: `apps/mobile/src/components/ContextualDrawer.tsx`
- Modify: `apps/mobile/src/components/TabBar.tsx`

- [ ] **Step 1: Create ContextualDrawer**

Half-sheet that slides up on long-press of a tab:
- Grab handle at top
- Glass elevated background
- Content depends on which tab was long-pressed:
  - Today: Scouts list (tap to navigate to scouts roster)
  - Upcoming: Lists picker (tap to navigate to list detail)
  - Calendar: Calendar settings placeholder
  - Any: Settings row with gear icon
- Swipe down or tap outside to dismiss

Implementation: `apps/mobile/src/components/ContextualDrawer.tsx`

Props: `{ tab: 'today' | 'inbox' | 'upcoming' | 'calendar'; visible: boolean; onDismiss: () => void; onNavigate: (route: string) => void }`

Use `react-native-reanimated` for the slide-up animation. The drawer uses a GlassCard elevated variant.

For the lists picker: show `useMockLists().navLists` with item counts and colored dots. Tap a list → `onNavigate(`/list/${list.id}`)`.

- [ ] **Step 2: Wire long-press into TabBar**

Add `onLongPress` handling to tab buttons in the custom TabBar. Long-press triggers rigid haptic + opens the ContextualDrawer for that tab.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/src/components/ContextualDrawer.tsx apps/mobile/src/components/TabBar.tsx && git commit -m "feat(mobile): add contextual drawer on tab long-press"
```

---

## Task 18: Long-Press Drag to Reorder

**Files:**
- Modify: `apps/mobile/src/components/TaskRow.tsx`
- Modify: `apps/mobile/app/(app)/(tabs)/today.tsx`

- [ ] **Step 1: Add drag-to-reorder to task lists**

Use `react-native-reanimated` + `react-native-gesture-handler` to implement:
- Long-press (500ms) → rigid haptic → row lifts (scale 1.03x, shadow)
- Drag: row follows finger, other items part with spring animation
- Drop: row settles to new position (350ms spring with slight bounce)

This requires the list to be a draggable list implementation. Consider using a simple approach:
- Track `draggedId` and `dragY` as shared values
- Other items calculate their offset based on the dragged item's position
- On drop, reorder the items array in state

For the prototype, implement this on the Today screen's task list first. The same pattern applies to all list screens.

Note: If this proves too complex for the prototype phase, a simpler approach is to use `react-native-draggable-flatlist` package. Install it if the manual implementation is too time-consuming:

```bash
cd apps/mobile && pnpm add react-native-draggable-flatlist
```

- [ ] **Step 2: Commit**

```bash
git add -A && git commit -m "feat(mobile): add long-press drag-to-reorder on task lists"
```

---

## Task 19: Sign-In Screen Restyling

**Files:**
- Modify: `apps/mobile/app/(auth)/sign-in.tsx`

- [ ] **Step 1: Restyle sign-in to match Brett's visual language**

Update the existing sign-in screen:
- `LivingBackground` behind everything
- Glass card centered on screen containing the form
- Brett product mark (gold) at top (use a simple gold dot cluster as placeholder, or the text "Brett" in gold)
- Email input with glass styling (dark surface, subtle border, white text)
- Password input same treatment
- "Sign In" button with gold background, dark text, rounded corners
- "Sign in with Google" button — white outline, white text
- "Sign in with Apple" button — native ASAuthorizationAppleIDButton styling (white on dark)
- Error state: red-tinted text
- Loading state: gold ActivityIndicator

Keep the existing auth logic (`useAuth().signIn`), just restyle the UI.

- [ ] **Step 2: Commit**

```bash
git add apps/mobile/app/(auth)/sign-in.tsx && git commit -m "feat(mobile): restyle sign-in screen with Brett visual language"
```

---

## Task 20: Final Polish Pass

**Files:** Various — across all components and screens

- [ ] **Step 1: Verify all screens on Simulator**

Walk through every screen on the iOS Simulator:
1. Sign in → Today (verify auth flow still works with mock data bypass)
2. Today: header, briefing, next up, all task sections, omnibar capture
3. Inbox: items with content indicators, empty state
4. Upcoming: date-grouped sections, empty state
5. Calendar: week strip, timeline events
6. Task detail: push navigation, back gesture, all sections
7. Settings: grouped-inset style, all sections
8. Scouts: roster → detail push
9. List detail: from contextual drawer
10. Voice mode: center button → overlay → dismiss
11. Morning ritual: clear AsyncStorage, reopen → cascade animation
12. Tab bar: switching, gold indicator, voice button glow
13. Contextual drawer: long-press each tab

- [ ] **Step 2: Fix any visual issues**

Common things to check:
- Safe area insets (notch, home indicator)
- Keyboard avoidance on omnibar
- Scroll behavior (content not hidden behind tab bar or omnibar)
- Glass card blur rendering on Simulator vs device
- Gold color consistency across all components
- Text readability over different background gradients
- Touch target sizes (44pt minimum)

- [ ] **Step 3: Add accessibility labels to key interactive elements**

Add `accessibilityLabel` and `accessibilityHint` to:
- Task checkboxes: "Complete [title]" / "Mark [title] incomplete"
- Task rows: "[title], [due date], [list name]"
- Omnibar: "Add a task"
- Tab bar items: "[Tab name] tab"
- Voice button: "Activate Brett voice mode"
- Back breadcrumbs: "Go back to [screen]"

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat(mobile): polish pass — fix visual issues, add accessibility labels"
```

---

## Verification Checklist

After all tasks are complete, verify:

- [ ] Tab navigation works: Today, Inbox, Upcoming, Calendar switch instantly
- [ ] Center voice button triggers voice mode overlay (does not navigate)
- [ ] Push navigation works: tap task → detail, swipe back returns
- [ ] Contextual drawer: long-press tabs → drawer slides up
- [ ] Omnibar: tap → keyboard, type → submit → task appears (mock)
- [ ] Task completion: checkbox → gold fill → haptic → stays in place → reflows after pause
- [ ] Swipe right on task → gold date action reveal
- [ ] Swipe left on task → cerulean select reveal
- [ ] Morning ritual: first open → cascade animation
- [ ] Living background: gradient visible behind glass cards
- [ ] Empty states: correct copy for each screen variant
- [ ] Daily briefing: collapsible, dismissible
- [ ] Settings: all sections visible with iOS grouped-inset style
- [ ] Scouts: roster → detail navigation works
- [ ] Accessibility: VoiceOver can navigate all key elements
