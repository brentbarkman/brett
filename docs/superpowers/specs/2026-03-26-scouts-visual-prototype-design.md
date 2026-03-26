# Scouts — Visual Prototype Design

## Overview

Scouts are autonomous sub-agents of Brett that monitor the outside world (web, APIs, feeds) and surface relevant findings as Items in the user's inbox. This spec covers the product design decisions and the visual prototype to be built as UI screens in the desktop app. No backend implementation — just the page-level UI.

## Product Design Decisions

### Scout Object Model

A Scout is its own entity (not an Item). Fields:

| Field | Description |
|-------|-------------|
| **name** | Auto-generated from goal, editable ("TSLA Thesis Watch") |
| **avatar** | Placeholder letter icon with gradient, auto-generated later |
| **goal** | Natural language description of what to watch for |
| **context** | Supporting info (e.g., your bull thesis) |
| **sources** | Where to look — URLs, feeds, APIs. Suggested by Brett, editable |
| **sensitivity** | How notable something needs to be before alerting |
| **cadence** | Base frequency + adaptive rules, proposed by Brett at creation |
| **budget** | Max runs/month with burst allowance. Per-scout + global backstop |
| **end date** | Optional, proposed by scout, editable |
| **status** | `active`, `paused`, `completed`, `expired` |
| **activity log** | Every run: what was checked, found, dismissed, cadence changes with reasoning |

### What Scouts Produce

Scouts create normal Items — not a special type. The scout is the **source/origin**, not the type.

- `type: "task"` when action is needed (e.g., "Review TSLA position before earnings")
- `type: "content"` with appropriate `contentType`:
  - `insight` — scout-generated analysis/alerts (new ContentType)
  - `article`, `podcast`, `video`, `web_page`, etc. — discovered content

The `source` field on the Item attributes it back to the originating scout (name + avatar).

### Scout Lifecycle Events That Create Inbox Items

These are all tasks requiring user action:
- Budget limit approaching
- Scout broken / can't run
- Mission complete (proposes retirement)
- Staleness check (60+ days with no findings)

### Creation Flow

Conversational with Brett, not a form:
1. User describes intent via omnibar
2. Brett interviews — asks for context, explores scope, clarifies sensitivity, suggests sources
3. Brett proposes full config (name, goal, context, sources, sensitivity, cadence, budget, end date)
4. User reviews, tweaks, confirms — "locks it in"

### Editing — Three Modes

1. **Re-open conversation** — from detail view, chat with Brett to change scope/strategy
2. **Direct edit** — config fields are editable for quick tweaks (budget, cadence, pause/resume)
3. **Feedback from findings** — "Not relevant" / "More like this" on inbox items trains the scout

### Lifecycle & States

- **Active** — running on schedule, adaptive cadence within budget
- **Paused** — manually paused, retains config, no runs
- **Completed** — reached end date or user retired after mission-complete prompt
- **Expired** — hit budget limit, user didn't approve more runs

Paused/completed scouts stay in roster (grayed out). Expired scouts prompt to approve budget or retire.

### Adaptive Cadence

- Scout proposes cadence at creation, user approves
- Scout adapts freely within budget (e.g., checks TSLA more often near earnings)
- Cadence changes are logged, visible in the detail view status line
- No inbox notification for cadence changes — the scout's status line and activity log are sufficient

### Cost Control

- Per-scout budget (runs/month with burst allowance), set at creation
- Global budget backstop in settings
- Inbox alert only when budget limit is approaching and a decision is needed

## Visual Prototype Scope

Build two screens as functional UI in the desktop app (mock data, no backend):

### Screen 1: Scouts Roster Page

Accessible from the "Scouts" nav item in the left sidebar. This is the management dashboard.

**Layout:** Standard app layout — left nav + main content area.

**Header:**
- Page title "Scouts"
- Subtitle: "Your scouts monitor the world and surface what matters."
- "New Scout" button (purple) — top right

**Scout Cards (vertical list):**
Each card shows:
- Gradient avatar circle with initial letter
- Scout name (bold)
- Status badge: green dot + "Active" or gray "Completed"
- Goal summary (1-2 lines, muted text)
- Metadata row: last run, findings count, cadence
- Elevated cadence shown in purple text (e.g., "Every 8h (elevated)")

**Scout states in roster:**
- Active cards: normal appearance, green status badge
- Completed/expired cards: reduced opacity, gray status badge

**Mock data — 4 scouts:**
1. TSLA Thesis Watch (active, elevated cadence, purple avatar)
2. Pediatric Nutrition Research (active, green avatar)
3. SaaS Competitor Tracker (active, amber avatar)
4. AAPL Q1 Earnings Watch (completed, gray avatar)

### Screen 2: Scout Detail View

Opened by clicking a scout card. Three-column layout: collapsed nav | scout list | detail panel.

**Left nav:** Collapses to icon-only (68px) when detail is open — matches existing app behavior.

**Scout list (narrow, ~380px):** Mini cards with avatar, name, status. Selected scout has purple border highlight.

**Detail panel (fills remaining width):**

**Header section:**
- Large avatar (56px) + scout name + status badge
- Adaptive status line in purple (e.g., "Monitoring closely — earnings Apr 2")
- Action buttons: Edit, Pause

**Config section (grid layout):**
- GOAL — full natural language description with thesis context
- SOURCES — list of monitored sources
- SENSITIVITY — description of threshold
- CADENCE — base frequency + current (if different, with reason)
- BUDGET — usage display (e.g., "38 / 60 runs this month")

**Tabs:**
- **Findings** (default active, shows count) — list of Items this scout has created
- **Activity Log** — chronological record of runs and decisions

**Findings list:**
Each finding shows icon (color-coded by type), title, description snippet, type + timestamp.

**Mock findings for TSLA scout:**
1. Insight (purple icon): "Unusual TSLA options volume — 3x average"
2. Article (blue icon): "Reuters: BYD outsells Tesla in Q1 globally for first time"
3. Task (amber icon): "Review TSLA position before earnings Apr 2"

## Design Language

Matches existing app aesthetic:
- Dark theme: `#0A0A0F` background, `#0D0D14` nav
- Text: white with opacity levels (100%, 90%, 60%, 50%, 40%, 30%)
- Cards: `#FFFFFF08` fill, `#FFFFFF0D` border, 12px corner radius
- Accents: purple `#8B5CF6` for scouts, green `#22C55E` for active, amber `#F59E0B` for tasks, blue `#3B82F6` for articles
- Scout avatars: gradient circles with initial letter
- Status badges: colored dot + text in tinted background
- Typography: Inter, 14px body, 11px metadata, 10px labels (uppercase, tracked)
- Spacing: 16px card padding, 12px gaps between cards, 32px section padding

## Out of Scope

- Backend: no Scout table, no API routes, no scheduling
- AI: no creation conversation, no adaptive cadence logic, no web scraping
- Functionality: no real data fetching, no state management beyond mock data
- Scout creation wizard/flow UI (future spec)
- Activity log tab content (future spec)
- Scout findings in the inbox view with avatar attribution (future spec)
