# Scouts Visual Prototype Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build two UI screens (Scouts roster + Scout detail view) with mock data in the desktop app.

**Architecture:** Add a page-switching mechanism to App.tsx via `activePage` state. Build two new components (ScoutsRoster, ScoutDetail) in `packages/ui/src/`. Add Scout types and mock data. Wire LeftNav to support page switching via `onNavigate` callback.

**Tech Stack:** React, TypeScript, Tailwind CSS (existing stack — no new dependencies)

**Spec:** `docs/superpowers/specs/2026-03-26-scouts-visual-prototype-design.md`

---

## File Map

| Action | File | Responsibility |
|--------|------|---------------|
| Modify | `packages/types/src/index.ts` | Add Scout interface and ScoutFinding type |
| Modify | `apps/desktop/src/data/mockData.ts` | Add mockScouts and mockScoutFindings data |
| Create | `packages/ui/src/ScoutCard.tsx` | Scout card for the roster list |
| Create | `packages/ui/src/ScoutsRoster.tsx` | Full roster page with header + scout list |
| Create | `packages/ui/src/ScoutDetail.tsx` | Detail view with config, findings, tabs |
| Modify | `packages/ui/src/LeftNav.tsx` | Add `activePage` and `onNavigate` props |
| Modify | `packages/ui/src/index.ts` | Export new components |
| Modify | `apps/desktop/src/App.tsx` | Add page switching, render Scouts views |

---

### Task 1: Add Scout Types

**Files:**
- Modify: `packages/types/src/index.ts`

- [ ] **Step 1: Add Scout and ScoutFinding interfaces to types**

Add after the existing `NavList` interface at the end of the file:

```typescript
// Scout types

export type ScoutStatus = "active" | "paused" | "completed" | "expired";

export interface Scout {
  id: string;
  name: string;
  avatarLetter: string;
  avatarGradient: [string, string]; // [fromColor, toColor]
  goal: string;
  context?: string;
  sources: string;
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
```

- [ ] **Step 2: Run typecheck to verify**

Run: `cd /Users/brentbarkman/code/brett/.claude/worktrees/scout-design && pnpm typecheck`
Expected: PASS (no errors — these are new types, nothing references them yet)

- [ ] **Step 3: Commit**

```bash
git add packages/types/src/index.ts
git commit -m "feat(types): add Scout and ScoutFinding interfaces"
```

---

### Task 2: Add Mock Scout Data

**Files:**
- Modify: `apps/desktop/src/data/mockData.ts`

- [ ] **Step 1: Add mockScouts array**

Add the following imports and data after the existing `mockBriefingItems` export:

```typescript
import type { Thing, CalendarEvent, NavList, Scout, ScoutFinding } from "@brett/types";
```

(Update the existing import at the top of the file to include `Scout` and `ScoutFinding`.)

Then add at the end of the file:

```typescript
export const mockScouts: Scout[] = [
  {
    id: "s1",
    name: "TSLA Thesis Watch",
    avatarLetter: "T",
    avatarGradient: ["#8B5CF6", "#6D28D9"],
    goal: "Monitor market conditions and news for anything that challenges my bull thesis on Tesla. Thesis: strong EV demand, FSD progress, energy business undervalued.",
    context: "Bull thesis based on EV demand growth, FSD regulatory progress, and energy storage revenue being undervalued by the market.",
    sources: "SEC filings, Bloomberg, Reuters, r/wallstreetbets, analyst reports, competitor news (Rivian, Lucid, BYD)",
    sensitivity: "Medium — notable developments and signals, not routine news",
    cadenceBase: "Every 3 days",
    cadenceCurrent: "Every 8 hours",
    cadenceReason: "Elevated for earnings Apr 2",
    budgetUsed: 38,
    budgetTotal: 60,
    status: "active",
    statusLine: "Monitoring closely — earnings Apr 2",
    lastRun: "2h ago",
    findingsCount: 12,
  },
  {
    id: "s2",
    name: "Pediatric Nutrition Research",
    avatarLetter: "N",
    avatarGradient: ["#22C55E", "#16A34A"],
    goal: "Track new credible studies and guidelines on infant and toddler nutrition from reputable medical journals and health organizations.",
    sources: "PubMed, WHO, AAP, NIH, Lancet, BMJ, major university research centers",
    sensitivity: "Low — surface anything from credible sources, even minor findings",
    cadenceBase: "Every 3 days",
    budgetUsed: 14,
    budgetTotal: 30,
    status: "active",
    lastRun: "1d ago",
    findingsCount: 6,
  },
  {
    id: "s3",
    name: "SaaS Competitor Tracker",
    avatarLetter: "C",
    avatarGradient: ["#F59E0B", "#D97706"],
    goal: "Watch for product launches, funding rounds, pricing changes, and key hires from Linear, Notion, and Height.",
    sources: "TechCrunch, Crunchbase, LinkedIn, Product Hunt, Hacker News, company blogs",
    sensitivity: "Medium — notable moves only, not routine blog posts",
    cadenceBase: "Every 2 days",
    budgetUsed: 22,
    budgetTotal: 45,
    status: "active",
    lastRun: "5h ago",
    findingsCount: 8,
  },
  {
    id: "s4",
    name: "AAPL Q1 Earnings Watch",
    avatarLetter: "E",
    avatarGradient: ["#FFFFFF15", "#FFFFFF15"],
    goal: "Monitored Apple earnings through Q1 2026 report. Mission complete — results in line with expectations.",
    sources: "SEC filings, Bloomberg, Apple Newsroom, analyst consensus",
    sensitivity: "High — only material developments",
    cadenceBase: "Every 2 days",
    budgetUsed: 47,
    budgetTotal: 60,
    status: "completed",
    lastRun: "Mar 15",
    endDate: "Mar 15, 2026",
    findingsCount: 23,
  },
];

export const mockScoutFindings: ScoutFinding[] = [
  {
    id: "sf1",
    scoutId: "s1",
    type: "insight",
    title: "Unusual TSLA options volume — 3x average",
    description: "Significant put volume detected ahead of earnings. May indicate institutional hedging or bearish sentiment building.",
    timestamp: "4 hours ago",
  },
  {
    id: "sf2",
    scoutId: "s1",
    type: "article",
    title: "Reuters: BYD outsells Tesla in Q1 globally for first time",
    description: "BYD reported 1.2M vehicles vs Tesla's 890K. Relevant to your thesis — competition thesis may need revisiting.",
    timestamp: "2 days ago",
  },
  {
    id: "sf3",
    scoutId: "s1",
    type: "task",
    title: "Review TSLA position before earnings Apr 2",
    description: "With unusual options activity and BYD competition news, you may want to review your position sizing ahead of the call.",
    timestamp: "4 hours ago",
  },
];
```

- [ ] **Step 2: Run typecheck**

Run: `cd /Users/brentbarkman/code/brett/.claude/worktrees/scout-design && pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/data/mockData.ts
git commit -m "feat(data): add mock scouts and scout findings"
```

---

### Task 3: Build ScoutCard Component

**Files:**
- Create: `packages/ui/src/ScoutCard.tsx`

- [ ] **Step 1: Create ScoutCard component**

```tsx
import React from "react";
import type { Scout } from "@brett/types";

interface ScoutCardProps {
  scout: Scout;
  onClick: () => void;
  isSelected?: boolean;
  variant?: "full" | "compact";
}

export function ScoutCard({ scout, onClick, isSelected, variant = "full" }: ScoutCardProps) {
  const isCompleted = scout.status === "completed" || scout.status === "expired";

  if (variant === "compact") {
    return (
      <button
        onClick={onClick}
        className={`
          flex items-center gap-3 w-full p-3 rounded-xl transition-colors text-left
          ${isSelected ? "bg-white/[0.06] border border-purple-500/25" : "bg-white/[0.02] border border-transparent hover:bg-white/[0.04]"}
        `}
      >
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
          style={{
            background: isCompleted
              ? "rgba(255,255,255,0.08)"
              : `linear-gradient(180deg, ${scout.avatarGradient[0]}, ${scout.avatarGradient[1]})`,
          }}
        >
          <span className={`text-sm font-bold ${isCompleted ? "text-white/30" : "text-white"}`}>
            {scout.avatarLetter}
          </span>
        </div>
        <div className="flex-1 min-w-0">
          <div className={`text-[13px] font-medium truncate ${isSelected ? "text-white" : "text-white/60"}`}>
            {scout.name}
          </div>
          <div className="text-[11px] text-white/30">
            {scout.status === "active" ? "Active" : scout.status === "completed" ? "Completed" : scout.status === "paused" ? "Paused" : "Expired"} · {scout.findingsCount} findings
          </div>
        </div>
      </button>
    );
  }

  return (
    <button
      onClick={onClick}
      className={`
        flex items-center gap-4 w-full p-4 rounded-xl transition-colors text-left
        bg-white/[0.03] border border-white/[0.05] hover:bg-white/[0.06] hover:border-white/[0.08]
        ${isCompleted ? "opacity-60" : ""}
      `}
    >
      <div
        className="w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0"
        style={{
          background: isCompleted
            ? "rgba(255,255,255,0.08)"
            : `linear-gradient(180deg, ${scout.avatarGradient[0]}, ${scout.avatarGradient[1]})`,
        }}
      >
        <span className={`text-lg font-bold ${isCompleted ? "text-white/30" : "text-white"}`}>
          {scout.avatarLetter}
        </span>
      </div>

      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-white truncate">{scout.name}</span>
          <StatusBadge status={scout.status} />
        </div>
        <p className="text-xs text-white/50 line-clamp-2">{scout.goal}</p>
        <div className="flex items-center gap-3 text-[11px] text-white/30">
          <span>Last run: {scout.lastRun ?? "Never"}</span>
          <span className="text-white/15">·</span>
          <span>{scout.findingsCount} findings</span>
          <span className="text-white/15">·</span>
          <span className={scout.cadenceCurrent ? "text-purple-400" : ""}>
            {scout.cadenceCurrent
              ? `${scout.cadenceCurrent} (elevated)`
              : scout.cadenceBase}
          </span>
        </div>
      </div>
    </button>
  );
}

function StatusBadge({ status }: { status: Scout["status"] }) {
  if (status === "active") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-green-500/20 text-[10px] font-semibold text-green-500">
        <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
        Active
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-white/[0.06] text-[10px] font-semibold text-white/40">
      {status === "completed" ? "Completed" : status === "paused" ? "Paused" : "Expired"}
    </span>
  );
}
```

- [ ] **Step 2: Run typecheck**

Run: `cd /Users/brentbarkman/code/brett/.claude/worktrees/scout-design && pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/ScoutCard.tsx
git commit -m "feat(ui): add ScoutCard component with full and compact variants"
```

---

### Task 4: Build ScoutsRoster Component

**Files:**
- Create: `packages/ui/src/ScoutsRoster.tsx`

- [ ] **Step 1: Create ScoutsRoster page component**

```tsx
import React from "react";
import { Plus } from "lucide-react";
import type { Scout } from "@brett/types";
import { ScoutCard } from "./ScoutCard";

interface ScoutsRosterProps {
  scouts: Scout[];
  onSelectScout: (scout: Scout) => void;
}

export function ScoutsRoster({ scouts, onSelectScout }: ScoutsRosterProps) {
  return (
    <div className="flex-1 min-w-0 overflow-y-auto scrollbar-hide py-2">
      <div className="max-w-3xl mx-auto w-full space-y-6 px-10 py-8">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-white">Scouts</h1>
          <button className="flex items-center gap-2 px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 transition-colors text-white text-[13px] font-semibold">
            <Plus size={16} />
            New Scout
          </button>
        </div>

        <p className="text-sm text-white/50">
          Your scouts monitor the world and surface what matters.
        </p>

        {/* Scout Cards */}
        <div className="space-y-3">
          {scouts.map((scout) => (
            <ScoutCard
              key={scout.id}
              scout={scout}
              onClick={() => onSelectScout(scout)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Run typecheck**

Run: `cd /Users/brentbarkman/code/brett/.claude/worktrees/scout-design && pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/ScoutsRoster.tsx
git commit -m "feat(ui): add ScoutsRoster page component"
```

---

### Task 5: Build ScoutDetail Component

**Files:**
- Create: `packages/ui/src/ScoutDetail.tsx`

- [ ] **Step 1: Create ScoutDetail component**

```tsx
import React, { useState } from "react";
import { Pencil, Pause, Zap, FileText, CircleCheck } from "lucide-react";
import type { Scout, ScoutFinding } from "@brett/types";
import { ScoutCard } from "./ScoutCard";

interface ScoutDetailProps {
  scouts: Scout[];
  selectedScout: Scout;
  findings: ScoutFinding[];
  onSelectScout: (scout: Scout) => void;
  onBack: () => void;
}

export function ScoutDetail({
  scouts,
  selectedScout,
  findings,
  onSelectScout,
  onBack,
}: ScoutDetailProps) {
  const [activeTab, setActiveTab] = useState<"findings" | "log">("findings");
  const scoutFindings = findings.filter((f) => f.scoutId === selectedScout.id);
  const isCompleted = selectedScout.status === "completed" || selectedScout.status === "expired";

  return (
    <div className="flex flex-1 min-w-0 h-full">
      {/* Scout List (left narrow panel) */}
      <div className="w-[380px] flex-shrink-0 border-r border-white/[0.05] overflow-y-auto scrollbar-hide p-5 space-y-4">
        <button
          onClick={onBack}
          className="text-lg font-bold text-white hover:text-white/80 transition-colors"
        >
          Scouts
        </button>
        <div className="space-y-2">
          {scouts.map((scout) => (
            <ScoutCard
              key={scout.id}
              scout={scout}
              onClick={() => onSelectScout(scout)}
              isSelected={scout.id === selectedScout.id}
              variant="compact"
            />
          ))}
        </div>
      </div>

      {/* Detail Panel */}
      <div className="flex-1 min-w-0 overflow-y-auto scrollbar-hide p-8 space-y-6">
        {/* Header */}
        <div className="flex items-start gap-4">
          <div
            className="w-14 h-14 rounded-full flex items-center justify-center flex-shrink-0"
            style={{
              background: isCompleted
                ? "rgba(255,255,255,0.08)"
                : `linear-gradient(180deg, ${selectedScout.avatarGradient[0]}, ${selectedScout.avatarGradient[1]})`,
            }}
          >
            <span className={`text-2xl font-bold ${isCompleted ? "text-white/30" : "text-white"}`}>
              {selectedScout.avatarLetter}
            </span>
          </div>

          <div className="flex-1 min-w-0 space-y-1">
            <div className="flex items-center gap-3">
              <h2 className="text-xl font-bold text-white">{selectedScout.name}</h2>
              <StatusBadge status={selectedScout.status} />
            </div>
            {selectedScout.statusLine && (
              <p className="text-[13px] font-medium text-purple-400/70">
                {selectedScout.statusLine}
              </p>
            )}
          </div>

          <div className="flex gap-2 flex-shrink-0">
            <ActionButton icon={<Pencil size={14} />} label="Edit" />
            <ActionButton icon={<Pause size={14} />} label="Pause" />
          </div>
        </div>

        {/* Divider */}
        <div className="h-px bg-white/[0.05]" />

        {/* Config Grid */}
        <div className="space-y-4">
          <ConfigField label="GOAL" value={selectedScout.goal} />
          <div className="grid grid-cols-2 gap-8">
            <ConfigField label="SOURCES" value={selectedScout.sources} />
            <ConfigField label="SENSITIVITY" value={selectedScout.sensitivity} />
          </div>
          <div className="grid grid-cols-2 gap-8">
            <ConfigField
              label="CADENCE"
              value={
                selectedScout.cadenceCurrent
                  ? `Base: ${selectedScout.cadenceBase}\nCurrent: ${selectedScout.cadenceCurrent} (${selectedScout.cadenceReason})`
                  : selectedScout.cadenceBase
              }
            />
            <ConfigField
              label="BUDGET"
              value={`${selectedScout.budgetUsed} / ${selectedScout.budgetTotal} runs this month`}
            />
          </div>
        </div>

        {/* Divider */}
        <div className="h-px bg-white/[0.05]" />

        {/* Tabs */}
        <div className="flex gap-0">
          <TabButton
            label="Findings"
            count={scoutFindings.length}
            isActive={activeTab === "findings"}
            onClick={() => setActiveTab("findings")}
          />
          <TabButton
            label="Activity Log"
            isActive={activeTab === "log"}
            onClick={() => setActiveTab("log")}
          />
        </div>

        {/* Tab Content */}
        {activeTab === "findings" ? (
          <div className="space-y-2">
            {scoutFindings.length > 0 ? (
              scoutFindings.map((finding) => (
                <FindingCard key={finding.id} finding={finding} />
              ))
            ) : (
              <p className="text-sm text-white/30 py-8 text-center">
                No findings yet. This scout is still monitoring.
              </p>
            )}
          </div>
        ) : (
          <p className="text-sm text-white/30 py-8 text-center">
            Activity log coming soon.
          </p>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: Scout["status"] }) {
  if (status === "active") {
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded bg-green-500/20 text-[11px] font-semibold text-green-500">
        <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
        Active
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-2.5 py-0.5 rounded bg-white/[0.06] text-[11px] font-semibold text-white/40">
      {status === "completed" ? "Completed" : status === "paused" ? "Paused" : "Expired"}
    </span>
  );
}

function ActionButton({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <button className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-white/[0.05] border border-white/[0.08] hover:bg-white/[0.08] transition-colors text-white/60 hover:text-white/80 text-xs font-medium">
      {icon}
      {label}
    </button>
  );
}

function ConfigField({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <div className="text-[10px] font-semibold tracking-wider text-white/30">{label}</div>
      <p className="text-[13px] text-white/60 leading-relaxed whitespace-pre-line">{value}</p>
    </div>
  );
}

function TabButton({
  label,
  count,
  isActive,
  onClick,
}: {
  label: string;
  count?: number;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`
        flex items-center gap-1.5 px-4 py-2 text-[13px] font-medium transition-colors
        ${isActive
          ? "text-white border-b-2 border-purple-500"
          : "text-white/40 hover:text-white/60"}
      `}
    >
      {label}
      {count !== undefined && (
        <span className="text-white/40 text-xs">{count}</span>
      )}
    </button>
  );
}

function FindingCard({ finding }: { finding: ScoutFinding }) {
  const iconConfig = {
    insight: { icon: <Zap size={14} />, bg: "bg-purple-500/15", color: "text-purple-400" },
    article: { icon: <FileText size={14} />, bg: "bg-blue-500/15", color: "text-blue-400" },
    task: { icon: <CircleCheck size={14} />, bg: "bg-amber-500/15", color: "text-amber-400" },
  }[finding.type];

  const typeLabel = {
    insight: "Insight",
    article: "Article",
    task: "Task",
  }[finding.type];

  return (
    <div className="flex gap-3 p-3.5 rounded-xl bg-white/[0.03] border border-white/[0.05]">
      <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${iconConfig.bg}`}>
        <span className={iconConfig.color}>{iconConfig.icon}</span>
      </div>
      <div className="flex-1 min-w-0 space-y-1">
        <h4 className="text-[13px] font-semibold text-white">{finding.title}</h4>
        <p className="text-xs text-white/50 leading-relaxed">{finding.description}</p>
        <span className="text-[11px] text-white/30">{typeLabel} · {finding.timestamp}</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Run typecheck**

Run: `cd /Users/brentbarkman/code/brett/.claude/worktrees/scout-design && pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/ScoutDetail.tsx
git commit -m "feat(ui): add ScoutDetail component with config, tabs, and findings"
```

---

### Task 6: Export New Components

**Files:**
- Modify: `packages/ui/src/index.ts`

- [ ] **Step 1: Add exports for new components**

Add these lines to the barrel export file:

```typescript
export { ScoutCard } from "./ScoutCard";
export { ScoutsRoster } from "./ScoutsRoster";
export { ScoutDetail } from "./ScoutDetail";
```

- [ ] **Step 2: Run typecheck**

Run: `cd /Users/brentbarkman/code/brett/.claude/worktrees/scout-design && pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/index.ts
git commit -m "feat(ui): export ScoutCard, ScoutsRoster, ScoutDetail"
```

---

### Task 7: Add Page Navigation to LeftNav

**Files:**
- Modify: `packages/ui/src/LeftNav.tsx`

- [ ] **Step 1: Add activePage and onNavigate props**

Update the `LeftNavProps` interface:

```typescript
interface LeftNavProps {
  isCollapsed: boolean;
  lists: NavList[];
  user?: LeftNavUser | null;
  activePage?: "today" | "inbox" | "scouts";
  onNavigate?: (page: "today" | "inbox" | "scouts") => void;
}
```

Update the component signature:

```typescript
export function LeftNav({ isCollapsed, lists, user, activePage = "today", onNavigate }: LeftNavProps) {
```

Update the three main NavItem entries to use `activePage` and `onNavigate` instead of the hardcoded `isActive` on Today. Replace the existing nav items section:

```tsx
<NavItem
  icon={<Calendar size={18} />}
  label="Today"
  badge={3}
  isActive={activePage === "today"}
  isCollapsed={isCollapsed}
  onClick={() => onNavigate?.("today")}
/>
<NavItem
  icon={<Inbox size={18} />}
  label="Inbox"
  badge={5}
  isActive={activePage === "inbox"}
  isCollapsed={isCollapsed}
  onClick={() => onNavigate?.("inbox")}
/>
<NavItem
  icon={<Search size={18} />}
  label="Scouts"
  badge={2}
  isActive={activePage === "scouts"}
  isCollapsed={isCollapsed}
  onClick={() => onNavigate?.("scouts")}
/>
```

Add `onClick` to the `NavItemProps` interface and the NavItem component:

```typescript
interface NavItemProps {
  icon: React.ReactNode;
  label: string;
  badge?: number;
  count?: number;
  isActive?: boolean;
  isCollapsed: boolean;
  onClick?: () => void;
}
```

Change the NavItem `<button>` to call `onClick`:

```tsx
<button
  onClick={onClick}
  className={`...existing classes...`}
>
```

- [ ] **Step 2: Run typecheck**

Run: `cd /Users/brentbarkman/code/brett/.claude/worktrees/scout-design && pnpm typecheck`
Expected: PASS (new props are optional, so existing usage in App.tsx still compiles)

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/LeftNav.tsx
git commit -m "feat(ui): add activePage and onNavigate props to LeftNav"
```

---

### Task 8: Wire Up Page Switching in App.tsx

**Files:**
- Modify: `apps/desktop/src/App.tsx`

- [ ] **Step 1: Add page state and scouts imports**

Add to imports:

```typescript
import {
  LeftNav,
  Omnibar,
  MorningBriefing,
  UpNextCard,
  FilterPills,
  ThingsList,
  CalendarTimeline,
  DetailPanel,
  ScoutsRoster,
  ScoutDetail,
} from "@brett/ui";
import type { Thing, CalendarEvent, Scout } from "@brett/types";
```

Update the mockData import:

```typescript
import {
  mockLists,
  mockThings,
  mockEvents,
  mockBriefingItems,
  mockScouts,
  mockScoutFindings,
} from "./data/mockData";
```

Add state variables inside the `App` component, after the existing state:

```typescript
const [activePage, setActivePage] = useState<"today" | "inbox" | "scouts">("today");
const [selectedScout, setSelectedScout] = useState<Scout | null>(null);
```

- [ ] **Step 2: Add navigation handler and scout selection**

Add after the existing `handleCloseDetail`:

```typescript
const handleNavigate = (page: "today" | "inbox" | "scouts") => {
  setActivePage(page);
  setSelectedScout(null);
  // Close detail panel when switching pages
  setIsDetailOpen(false);
  setTimeout(() => setSelectedItem(null), 300);
};

const handleSelectScout = (scout: Scout) => {
  setSelectedScout(scout);
};

const handleBackToRoster = () => {
  setSelectedScout(null);
};
```

- [ ] **Step 3: Update the LeftNav to pass new props**

Replace the LeftNav in the JSX:

```tsx
<LeftNav
  isCollapsed={isDetailOpen || (activePage === "scouts" && selectedScout !== null)}
  lists={mockLists}
  user={user}
  activePage={activePage}
  onNavigate={handleNavigate}
/>
```

- [ ] **Step 4: Conditionally render Today view or Scouts view**

Replace the center column (`<main>` tag and its contents) and the right column (CalendarTimeline) with:

```tsx
{activePage === "scouts" ? (
  selectedScout ? (
    <ScoutDetail
      scouts={mockScouts}
      selectedScout={selectedScout}
      findings={mockScoutFindings}
      onSelectScout={handleSelectScout}
      onBack={handleBackToRoster}
    />
  ) : (
    <ScoutsRoster
      scouts={mockScouts}
      onSelectScout={handleSelectScout}
    />
  )
) : (
  <>
    {/* Center Column: Main Today View */}
    <main className="flex-1 min-w-0 overflow-y-auto scrollbar-hide py-2">
      <div className="max-w-3xl mx-auto w-full space-y-4">
        <Omnibar />

        {isBriefingVisible && (
          <MorningBriefing
            items={mockBriefingItems}
            onDismiss={() => setIsBriefingVisible(false)}
          />
        )}

        {upNextEvent && (
          <UpNextCard
            event={upNextEvent}
            onClick={() => handleItemClick(upNextEvent)}
          />
        )}

        <div className="bg-black/30 backdrop-blur-xl rounded-xl border border-white/10 px-4 py-3">
          <FilterPills
            activeFilter={activeFilter}
            onSelectFilter={setActiveFilter}
          />
        </div>

        <ThingsList things={filteredThings} onItemClick={handleItemClick} />
      </div>
    </main>

    {/* Right Column: Calendar */}
    <div className="w-[300px] flex-shrink-0 py-2">
      <CalendarTimeline
        events={mockEvents}
        onEventClick={handleItemClick}
      />
    </div>
  </>
)}
```

- [ ] **Step 5: Run typecheck**

Run: `cd /Users/brentbarkman/code/brett/.claude/worktrees/scout-design && pnpm typecheck`
Expected: PASS

- [ ] **Step 6: Run dev server to visually verify**

Run: `cd /Users/brentbarkman/code/brett/.claude/worktrees/scout-design && pnpm dev:desktop`

Verify:
1. App loads on Today view (existing behavior unchanged)
2. Click "Scouts" in left nav → shows roster page with 4 scout cards
3. Click a scout card → shows detail view with collapsed nav, scout list, and detail panel
4. Click "Scouts" title in detail view → back to roster
5. Click "Today" in nav → back to Today view

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/App.tsx
git commit -m "feat: wire up Scouts page with routing, roster, and detail views"
```

---

## Summary

| Task | What | Files |
|------|------|-------|
| 1 | Scout types | `packages/types/src/index.ts` |
| 2 | Mock data | `apps/desktop/src/data/mockData.ts` |
| 3 | ScoutCard component | `packages/ui/src/ScoutCard.tsx` |
| 4 | ScoutsRoster page | `packages/ui/src/ScoutsRoster.tsx` |
| 5 | ScoutDetail page | `packages/ui/src/ScoutDetail.tsx` |
| 6 | Barrel exports | `packages/ui/src/index.ts` |
| 7 | LeftNav navigation | `packages/ui/src/LeftNav.tsx` |
| 8 | App.tsx wiring | `apps/desktop/src/App.tsx` |
