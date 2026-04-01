# Settings Page Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the scrolling single-page settings with a vertical sidebar + detail pane layout where the left nav auto-collapses.

**Architecture:** New `SettingsLayout` orchestrator renders a `SettingsSidebar` (200px) and a detail pane side-by-side. Active category is component state, not route state. Existing section components are reused as-is. LeftNav collapse is triggered by checking the current route in App.tsx.

**Tech Stack:** React, TypeScript, Tailwind CSS transitions (no framer-motion — project uses CSS transitions only), React Router v7.

**Spec:** `docs/superpowers/specs/2026-04-01-settings-redesign-design.md`

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `apps/desktop/src/settings/SettingsSidebar.tsx` | Vertical grouped category navigation |
| Create | `apps/desktop/src/settings/SettingsLayout.tsx` | Orchestrator: sidebar + detail pane, state, transitions |
| Modify | `apps/desktop/src/settings/SettingsPage.tsx` | Thin wrapper that renders SettingsLayout |
| Modify | `apps/desktop/src/App.tsx:831` | Add settings route to LeftNav collapse condition |

---

## Task 1: Add settings route to LeftNav collapse trigger

**Files:**
- Modify: `apps/desktop/src/App.tsx:831`

- [ ] **Step 1: Update the isCollapsed prop**

In `apps/desktop/src/App.tsx`, find the LeftNav `isCollapsed` prop (line ~831):

```typescript
isCollapsed={isDetailOpen || (location.pathname === "/scouts" && selectedScoutId !== null)}
```

Change it to:

```typescript
isCollapsed={isDetailOpen || (location.pathname === "/scouts" && selectedScoutId !== null) || location.pathname === "/settings"}
```

- [ ] **Step 2: Verify typecheck passes**

Run: `cd /Users/brentbarkman/code/brett/.worktrees/settings-cleanup && pnpm typecheck`
Expected: All 18 tasks successful.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/App.tsx
git commit -m "feat(settings): collapse left nav when settings is active"
```

---

## Task 2: Create SettingsSidebar component

**Files:**
- Create: `apps/desktop/src/settings/SettingsSidebar.tsx`

- [ ] **Step 1: Create the sidebar component**

Create `apps/desktop/src/settings/SettingsSidebar.tsx`:

```tsx
import React from "react";
import { ArrowLeft, LogOut, Trash2 } from "lucide-react";

export type SettingsCategory =
  | "profile"
  | "security"
  | "calendar"
  | "ai-providers"
  | "memory"
  | "timezone-location"
  | "briefing"
  | "import";

interface SidebarGroup {
  label: string;
  items: { id: SettingsCategory; label: string }[];
}

const GROUPS: SidebarGroup[] = [
  {
    label: "Account",
    items: [
      { id: "profile", label: "Profile" },
      { id: "security", label: "Security" },
    ],
  },
  {
    label: "Connections",
    items: [{ id: "calendar", label: "Calendar" }],
  },
  {
    label: "Intelligence",
    items: [
      { id: "ai-providers", label: "AI Providers" },
      { id: "memory", label: "Memory" },
    ],
  },
  {
    label: "Preferences",
    items: [
      { id: "timezone-location", label: "Timezone & Location" },
      { id: "briefing", label: "Briefing" },
    ],
  },
  {
    label: "Data",
    items: [{ id: "import", label: "Import" }],
  },
];

// Flat ordered list for index-based direction tracking
export const ALL_CATEGORIES: SettingsCategory[] = GROUPS.flatMap((g) =>
  g.items.map((i) => i.id)
);

interface SettingsSidebarProps {
  activeCategory: SettingsCategory;
  onCategorySelect: (category: SettingsCategory) => void;
  onBack: () => void;
  onSignOut: () => void;
  onDeleteAccount: () => void;
}

export function SettingsSidebar({
  activeCategory,
  onCategorySelect,
  onBack,
  onSignOut,
  onDeleteAccount,
}: SettingsSidebarProps) {
  return (
    <div className="w-[200px] flex-shrink-0 bg-white/5 border-r border-white/5 flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 pt-4 pb-5">
        <button
          onClick={onBack}
          className="text-white/40 hover:text-white transition-colors p-0.5 rounded-md hover:bg-white/5"
        >
          <ArrowLeft size={16} />
        </button>
        <span className="text-sm font-semibold text-white">Settings</span>
      </div>

      {/* Category groups */}
      <div className="flex-1 overflow-y-auto scrollbar-hide px-2">
        {GROUPS.map((group, gi) => (
          <div key={group.label} className={gi > 0 ? "mt-4" : ""}>
            <div className="text-[8px] uppercase tracking-[1.5px] text-white/30 px-2.5 mb-2 font-semibold">
              {group.label}
            </div>
            <div className="space-y-0.5">
              {group.items.map((item) => (
                <button
                  key={item.id}
                  onClick={() => onCategorySelect(item.id)}
                  className={`w-full text-left text-[11px] px-2.5 py-[7px] rounded-md transition-colors ${
                    activeCategory === item.id
                      ? "bg-white/10 text-white/90"
                      : "text-white/40 hover:bg-white/5 hover:text-white/50"
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Bottom actions */}
      <div className="mt-auto px-2 pb-4 space-y-0.5">
        <div className="h-px bg-white/10 mx-2.5 mb-2" />
        <button
          onClick={onSignOut}
          className="w-full text-left text-[11px] px-2.5 py-[7px] rounded-md text-white/30 hover:bg-white/5 hover:text-white/50 transition-colors flex items-center gap-2"
        >
          <LogOut size={12} />
          Sign Out
        </button>
        <button
          onClick={onDeleteAccount}
          className="w-full text-left text-[11px] px-2.5 py-[7px] rounded-md text-red-400/60 hover:bg-red-500/10 hover:text-red-400 transition-colors flex items-center gap-2"
        >
          <Trash2 size={12} />
          Delete Account
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify typecheck passes**

Run: `cd /Users/brentbarkman/code/brett/.worktrees/settings-cleanup && pnpm typecheck`
Expected: All 18 tasks successful.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/settings/SettingsSidebar.tsx
git commit -m "feat(settings): add vertical sidebar navigation component"
```

---

## Task 3: Create SettingsLayout orchestrator

**Files:**
- Create: `apps/desktop/src/settings/SettingsLayout.tsx`

- [ ] **Step 1: Create the layout orchestrator**

Create `apps/desktop/src/settings/SettingsLayout.tsx`:

```tsx
import React, { useState, useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import {
  SettingsSidebar,
  SettingsCategory,
  ALL_CATEGORIES,
} from "./SettingsSidebar";
import { ProfileSection } from "./ProfileSection";
import { SecuritySection } from "./SecuritySection";
import { CalendarSection } from "./CalendarSection";
import { TimezoneSection } from "./TimezoneSection";
import { LocationSection } from "./LocationSection";
import { BriefingSection } from "./BriefingSection";
import { AISection } from "./AISection";
import { MemorySection } from "./MemorySection";
import { ImportSection } from "./ImportSection";
import { DeleteAccountDialog } from "./DeleteAccountDialog";
import { useAuth } from "../auth/AuthContext";
import { authClient } from "../auth/authClient";

interface SettingsLayoutProps {
  onBack: () => void;
}

function categoryFromHash(hash: string): SettingsCategory | null {
  const id = hash.slice(1); // remove '#'
  if (ALL_CATEGORIES.includes(id as SettingsCategory)) {
    return id as SettingsCategory;
  }
  return null;
}

export function SettingsLayout({ onBack }: SettingsLayoutProps) {
  const location = useLocation();
  const { user, signOut } = useAuth();

  const initialCategory = categoryFromHash(location.hash) || "profile";
  const [activeCategory, setActiveCategory] =
    useState<SettingsCategory>(initialCategory);
  const [slideDirection, setSlideDirection] = useState<"up" | "down" | null>(
    null
  );
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  function handleCategorySelect(category: SettingsCategory) {
    if (category === activeCategory) return;

    const oldIndex = ALL_CATEGORIES.indexOf(activeCategory);
    const newIndex = ALL_CATEGORIES.indexOf(category);
    const direction = newIndex > oldIndex ? "up" : "down";

    setSlideDirection(direction);
    setIsTransitioning(true);

    // After old content fades out, swap and slide in
    requestAnimationFrame(() => {
      setActiveCategory(category);
      // Reset scroll
      if (contentRef.current) {
        contentRef.current.scrollTop = 0;
      }
      // Allow the entering animation to play, then clear transition state
      setTimeout(() => {
        setIsTransitioning(false);
        setSlideDirection(null);
      }, 200);
    });
  }

  async function handleDeleteAccount() {
    const { error } = await authClient.deleteUser();
    if (error) {
      throw new Error(error.message || "Failed to delete account");
    }
    await signOut();
  }

  function renderContent() {
    switch (activeCategory) {
      case "profile":
        return <ProfileSection />;
      case "security":
        return <SecuritySection />;
      case "calendar":
        return <CalendarSection />;
      case "ai-providers":
        return <AISection />;
      case "memory":
        return <MemorySection />;
      case "timezone-location":
        return (
          <div className="space-y-3">
            <TimezoneSection />
            <LocationSection />
          </div>
        );
      case "briefing":
        return <BriefingSection />;
      case "import":
        return <ImportSection userId={user?.id ?? ""} />;
      default:
        return null;
    }
  }

  // Compute page title and subtitle
  const PAGE_META: Record<SettingsCategory, { title: string; subtitle: string }> = {
    profile: {
      title: "Profile",
      subtitle: "Your personal information and display settings",
    },
    security: {
      title: "Security",
      subtitle: "Password, passkeys, and sign-in methods",
    },
    calendar: {
      title: "Calendar",
      subtitle: "Connected calendars and integrations",
    },
    "ai-providers": {
      title: "AI Providers",
      subtitle: "Configure AI models and API keys",
    },
    memory: {
      title: "Memory",
      subtitle: "What Brett knows about you",
    },
    "timezone-location": {
      title: "Timezone & Location",
      subtitle: "Time, location, and weather preferences",
    },
    briefing: {
      title: "Briefing",
      subtitle: "Daily briefing preferences",
    },
    import: {
      title: "Import",
      subtitle: "Import data from other apps",
    },
  };

  const meta = PAGE_META[activeCategory];

  // Slide animation classes
  const enterFrom = slideDirection === "up" ? "translate-y-3" : "-translate-y-3";
  const contentClasses = isTransitioning
    ? `opacity-0 ${enterFrom}`
    : "opacity-100 translate-y-0";

  return (
    <div className="flex-1 min-w-0 flex h-full">
      <SettingsSidebar
        activeCategory={activeCategory}
        onCategorySelect={handleCategorySelect}
        onBack={onBack}
        onSignOut={signOut}
        onDeleteAccount={() => setDeleteDialogOpen(true)}
      />

      {/* Detail pane */}
      <div ref={contentRef} className="flex-1 min-w-0 overflow-y-auto scrollbar-hide">
        <div className="max-w-[640px] px-8 pt-5 pb-12">
          <div
            className={`transition-all duration-200 ease-out ${contentClasses}`}
          >
            <h1 className="text-[17px] font-semibold text-white">
              {meta.title}
            </h1>
            <p className="text-[11px] text-white/30 mt-1 mb-5">{meta.subtitle}</p>
            <div className="space-y-3">{renderContent()}</div>
          </div>
        </div>
      </div>

      <DeleteAccountDialog
        isOpen={deleteDialogOpen}
        onClose={() => setDeleteDialogOpen(false)}
        onConfirm={handleDeleteAccount}
      />
    </div>
  );
}
```

- [ ] **Step 2: Verify typecheck passes**

Run: `cd /Users/brentbarkman/code/brett/.worktrees/settings-cleanup && pnpm typecheck`
Expected: All 18 tasks successful.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/settings/SettingsLayout.tsx
git commit -m "feat(settings): add layout orchestrator with sidebar + detail pane"
```

---

## Task 4: Replace SettingsPage with new layout

**Files:**
- Modify: `apps/desktop/src/settings/SettingsPage.tsx`

- [ ] **Step 1: Replace SettingsPage contents**

Replace the entire contents of `apps/desktop/src/settings/SettingsPage.tsx` with:

```tsx
import React from "react";
import { SettingsLayout } from "./SettingsLayout";

interface SettingsPageProps {
  onBack: () => void;
}

export function SettingsPage({ onBack }: SettingsPageProps) {
  return (
    <main className="flex-1 min-w-0 h-full">
      <SettingsLayout onBack={onBack} />
    </main>
  );
}
```

- [ ] **Step 2: Verify typecheck passes**

Run: `cd /Users/brentbarkman/code/brett/.worktrees/settings-cleanup && pnpm typecheck`
Expected: All 18 tasks successful.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/settings/SettingsPage.tsx
git commit -m "feat(settings): replace scrolling page with sidebar layout"
```

---

## Task 5: Manual QA and transition polish

This task covers visual verification and fixing any issues found during testing.

- [ ] **Step 1: Start the dev server**

Run: `cd /Users/brentbarkman/code/brett/.worktrees/settings-cleanup && pnpm dev:desktop`

- [ ] **Step 2: Navigate to settings and verify layout**

Check the following:
1. Left nav collapses to icon mode (68px) when navigating to `/settings`
2. Settings sidebar renders at 200px with grouped categories
3. Detail pane fills remaining width, content is max 640px
4. Back arrow in sidebar navigates back to previous page
5. Clicking category items swaps the detail pane content
6. Slide transition animates in the correct direction (down→up when clicking a lower item, up→down for higher)
7. Sign Out at bottom of sidebar triggers sign-out
8. Delete Account at bottom opens the confirmation dialog
9. Hash deep-linking works: navigate to `/settings#ai-providers` and verify AI Providers is selected
10. Left nav expands back to 220px when clicking any nav item (Inbox, Today, etc.)

- [ ] **Step 3: Fix any visual issues found**

Common things to check:
- Sidebar background contrast against the app background
- Active item highlight visibility
- Spacing between groups feels balanced
- Content area scrolls independently when a section is tall (e.g., AI Providers)
- Transition doesn't feel jarring — adjust duration/distance if needed

- [ ] **Step 4: Verify typecheck still passes**

Run: `cd /Users/brentbarkman/code/brett/.worktrees/settings-cleanup && pnpm typecheck`
Expected: All 18 tasks successful.

- [ ] **Step 5: Commit any polish fixes**

```bash
git add -A
git commit -m "fix(settings): polish layout and transitions after QA"
```

---

## Task 6: Clean up unused code

**Files:**
- Modify: `apps/desktop/src/settings/SettingsPage.tsx` (already done — verify no dead imports)
- Check: `apps/desktop/src/settings/SignOutSection.tsx` — still used?

- [ ] **Step 1: Check if SignOutSection is imported anywhere else**

Search the codebase for imports of `SignOutSection`. If it's only imported by the old `SettingsPage.tsx` (which we replaced), it's now unused.

- [ ] **Step 2: Remove unused imports and files if confirmed**

If `SignOutSection` is only used by the old SettingsPage, it's now dead code since sign-out is handled directly in the sidebar. However, keep the file — it's small and may be useful if the settings layout changes again. Just verify it's not imported anywhere.

- [ ] **Step 3: Verify typecheck passes**

Run: `cd /Users/brentbarkman/code/brett/.worktrees/settings-cleanup && pnpm typecheck`
Expected: All 18 tasks successful.

- [ ] **Step 4: Commit cleanup**

```bash
git add -A
git commit -m "chore(settings): remove unused imports from old layout"
```
