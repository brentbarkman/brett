# Scouts Backend Design Spec

**Date:** 2026-03-30
**Status:** Draft
**Context:** Visual prototype (UI + mock data) is merged to main. This spec covers the full backend implementation to make Scouts real.

## Overview

Scouts are AI sub-agents that monitor the internet for user-defined goals. A user describes what they care about ("monitor Tesla earnings", "track pediatric nutrition research"), and Brett creates a scout that periodically searches the web, analyzes results, and surfaces relevant findings to the user's inbox.

## Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Search providers | Tavily (general web) + Exa (people/companies), abstracted behind interface | Swappable — Perplexity replaces Tavily later |
| Search provider keys | Service-side env vars, not user-facing | Users don't know or care about search internals |
| LLM for analysis | User's BYOK key | Consistent with AI platform. Scouts require a configured AI key. |
| Job runner | Database-driven polling via cron | Stateless, survives restarts, no separate worker |
| Findings storage | Separate ScoutFinding table, auto-promotes to Items above threshold | Independent scout history, clean inbox |
| Budget unit | One execution cycle = one run | Simple, intuitive, matches UI |
| Global backstop | Per-user cap (visible) + system-wide cap (invisible ops safety) | Product feature + ops control |
| Activity log | Run-level + config changes + LLM reasoning | Full transparency builds trust |
| Scout creation | Conversational with Brett via omnibar or dedicated panel | Both entry points use same create_scout skill |
| Admin | API routes only, no auth guard for now | Admin panel deferred |

---

## 1. Data Model

### Scout

```
Scout
  id              String    @id @default(cuid())
  userId          String
  user            User      @relation(fields: [userId], references: [id])
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  name            String
  avatarLetter    String
  avatarGradientFrom String
  avatarGradientTo   String
  goal            String    @db.Text
  context         String?   @db.Text
  sources         Json      // [{name: string, url?: string}]

  sensitivity     ScoutSensitivity  @default(medium)
  cadenceIntervalHours       Float   // base cadence (e.g., 72 for "every 3 days")
  cadenceMinIntervalHours    Float   // burst minimum (e.g., 1 for "every hour")
  cadenceCurrentIntervalHours Float  // adaptive, starts equal to base
  cadenceReason              String? // why it's elevated

  budgetTotal     Int       // max runs per month
  budgetUsed      Int       @default(0)
  budgetResetAt   DateTime  // first of next month

  status          ScoutStatus @default(active)
  statusLine      String?
  endDate         DateTime?
  nextRunAt       DateTime  // drives the cron

  conversationSessionId String? // links to creation conversation with Brett

  runs            ScoutRun[]
  findings        ScoutFinding[]
  activity        ScoutActivity[]
```

### ScoutRun

```
ScoutRun
  id              String    @id @default(cuid())
  scoutId         String
  scout           Scout     @relation(fields: [scoutId], references: [id])
  createdAt       DateTime  @default(now())

  status          ScoutRunStatus  // success, failed, skipped
  searchQueries   Json            // what was searched
  resultCount     Int             // raw results from search providers
  findingsCount   Int             // findings that crossed threshold
  dismissedCount  Int             // results below threshold
  reasoning       String  @db.Text // LLM's full reasoning for the run
  tokensUsed      Int
  durationMs      Int
  error           String? @db.Text

  findings        ScoutFinding[]
```

### ScoutFinding

```
ScoutFinding
  id              String    @id @default(cuid())
  scoutId         String
  scout           Scout     @relation(fields: [scoutId], references: [id])
  scoutRunId      String
  scoutRun        ScoutRun  @relation(fields: [scoutRunId], references: [id])
  createdAt       DateTime  @default(now())

  type            FindingType     // insight, article, task
  title           String
  description     String  @db.Text
  sourceUrl       String?
  sourceName      String
  relevanceScore  Float           // 0-1
  reasoning       String  @db.Text // why this crossed the threshold

  itemId          String?  @unique // FK to Item, set when auto-promoted
  item            Item?    @relation(fields: [itemId], references: [id])
  dismissed       Boolean  @default(false)
```

### ScoutActivity

```
ScoutActivity
  id              String    @id @default(cuid())
  scoutId         String
  scout           Scout     @relation(fields: [scoutId], references: [id])
  createdAt       DateTime  @default(now())

  type            ScoutActivityType  // created, paused, resumed, completed, expired, config_changed, cadence_adapted, budget_alert
  description     String   @db.Text
  metadata        Json?
```

### Enums

```
enum ScoutStatus { active, paused, completed, expired }
enum ScoutSensitivity { low, medium, high }
enum ScoutRunStatus { success, failed, skipped }
enum FindingType { insight, article, task }
enum ScoutActivityType { created, paused, resumed, completed, expired, config_changed, cadence_adapted, budget_alert }
```

### Environment Variables

```
TAVILY_API_KEY           # Service-side Tavily key
EXA_API_KEY              # Service-side Exa key
SCOUT_TICK_SECRET        # Auth for cron endpoint
SCOUT_TICK_INTERVAL_MIN  # How often cron fires (default: 5)
SCOUT_SYSTEM_BUDGET_MONTHLY  # Global run cap across all users
```

---

## 2. Search Provider Abstraction

### Interface

```typescript
interface SearchProvider {
  search(query: string, options?: SearchOptions): Promise<SearchResult[]>
}

interface SearchOptions {
  maxResults?: number
  searchDepth?: "basic" | "advanced"
  includeContent?: boolean
  domains?: string[]
}

interface SearchResult {
  title: string
  url: string
  snippet: string
  content?: string
  publishedDate?: string
  score?: number
}
```

### Providers

**TavilySearchProvider** — default for general web search. Uses Tavily search + extract APIs. Maps `domains` to `include_domains`.

**ExaSearchProvider** — used for people/company monitoring. Uses Exa's neural search with entity type filters.

### Provider Selection

A scout run routes queries to providers based on source types:
- Sources containing LinkedIn, Crunchbase, or company-specific domains → Exa
- Everything else → Tavily
- A single run can use both providers if sources span categories

### Factory

```typescript
function getSearchProvider(type: "web" | "entity"): SearchProvider
```

Swapping Tavily for Perplexity later means writing `PerplexitySearchProvider` and changing the factory mapping. Nothing else changes.

---

## 3. Scout Runner (Execution Engine)

### Tick Endpoint

`POST /internal/scout-tick` — called by Railway cron every 5 minutes.

- Authenticated via `SCOUT_TICK_SECRET` header (not user auth)
- Queries scouts where `status = active AND nextRunAt <= now()`
- Executes due scouts in parallel with concurrency limit
- Also checks: `endDate <= now` → expire, `budgetResetAt <= now` → reset budget

### Single Scout Run Flow

1. **Budget check** — `budgetUsed >= budgetTotal` or global budget exceeded → skip, log `ScoutRun(status: skipped)`
2. **BYOK check** — fetch user's AI config. No valid LLM key → skip, log error
3. **Build search queries** — LLM takes scout's `goal`, `context`, `sources`, and last 5 findings (dedup). Generates 1-3 targeted search queries.
4. **Execute searches** — route through appropriate providers based on source types. Collect raw results.
5. **LLM judgment** — send results + goal + sensitivity to LLM. For each result: `{relevant, type, title, description, relevanceScore, reasoning}`. Sensitivity threshold: low=0.3, medium=0.5, high=0.7.
6. **Create findings** — `ScoutFinding` rows for results above threshold.
7. **Auto-promote to inbox** — create `Item` rows with `source: "scout"`, `sourceId: scoutId`. Set `finding.itemId`.
8. **Adaptive cadence** — LLM returns recommendation: "elevate" / "maintain" / "relax". Elevate pushes `cadenceCurrentIntervalHours` toward `cadenceMinIntervalHours`. Relax pushes back toward `cadenceIntervalHours`. Log `ScoutActivity(type: cadence_adapted)`.
9. **Update scout** — increment `budgetUsed`, set `nextRunAt = now + cadenceCurrentIntervalHours`.
10. **Log the run** — create `ScoutRun` with reasoning, counts, duration, tokens.

### SSE Notifications

After findings are created, push events via existing SSE infrastructure:
- `scout:finding` — new finding created
- `scout:run` — run completed
- `scout:status` — status changed

### Error Handling

Search or LLM failure → `ScoutRun(status: failed, error: message)`. Don't increment budget. Set `nextRunAt` to retry in 30 minutes.

---

## 4. API Routes

All routes in `apps/api/src/routes/scouts.ts`, user-authenticated via existing auth middleware.

### CRUD

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/scouts` | List user's scouts. Returns with computed `findingsCount` and `lastRun`. Supports `?status=active` filter. |
| `GET` | `/scouts/:id` | Full scout detail with recent findings and activity. |
| `POST` | `/scouts` | Create scout. Sets `nextRunAt`, `budgetResetAt`. Logs `ScoutActivity(type: created)`. |
| `PUT` | `/scouts/:id` | Update config fields. Logs `ScoutActivity(type: config_changed)` with diff. |
| `DELETE` | `/scouts/:id` | Soft delete — sets `status = completed`. |

### Lifecycle

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/scouts/:id/pause` | Set status to paused, clear nextRunAt. Log activity. |
| `POST` | `/scouts/:id/resume` | Set status to active, set nextRunAt = now. Log activity. |
| `POST` | `/scouts/:id/run` | Manual trigger — runs scout immediately regardless of nextRunAt. |

### Findings

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/scouts/:id/findings` | Paginated findings. Supports `?type=insight\|article\|task` filter. |
| `POST` | `/scouts/:id/findings/:findingId/dismiss` | Dismiss finding, remove linked Item if exists. |
| `POST` | `/scouts/:id/findings/:findingId/promote` | Manually promote finding to Item in inbox. |

### Activity

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/scouts/:id/activity` | Paginated activity log. ScoutRun + ScoutActivity interleaved, sorted by timestamp desc. |

### Budget

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/scouts/budget` | Global budget summary — total runs this month, per-scout breakdown. |

### Admin (no auth guard — admin panel deferred)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/admin/scouts/stats` | Global run counts, budget usage, error rate, active scout count across all users. |
| `POST` | `/admin/scouts/pause-all` | Emergency kill switch — pauses all scouts system-wide. |
| `POST` | `/admin/scouts/resume-all` | Lifts the kill switch. |
| `GET` | `/admin/scouts/runs` | Recent runs across all users with status/error info. |

### Internal

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/internal/scout-tick` | Cron endpoint. Authenticated via `SCOUT_TICK_SECRET`. |

---

## 5. Scout Creation via Brett

### Skill: `create_scout`

Registered in the skill system. Triggered by intent: "monitor", "watch", "track", "scout", "keep an eye on."

### Creation Conversation Flow

1. **Goal** — Brett asks: "What specifically should I watch for? What would make you want to know about it?"
2. **Sources** — Brett asks: "Any specific sources? Or should I figure that out?" Brett suggests sources based on domain (SEC EDGAR for stocks, PubMed for research, etc.)
3. **Config proposal** — Brett proposes: name, avatar (letter + gradient), goal summary, sources, sensitivity, cadence, budget, optional end date.
4. **User confirms or adjusts** — "Looks good" creates. Or "check more often" / "add Reuters" and Brett adjusts.
5. **Created** — `POST /scouts` called. Brett confirms: "Scout is live. First check in {cadence}."

### System Prompt Guidelines

- Sensitivity recommendations: financial = medium/high, research = low, competitor = medium
- Cadence recommendations: time-sensitive = hours, general research = days
- Budget recommendations: budget >= 2x expected runs per month
- Source suggestions by domain

### "Edit with Brett" Flow

Same `create_scout` skill in update mode. Brett receives current config + recent findings. User gives feedback ("this wasn't relevant", "check more often near earnings"). Brett proposes changes, user confirms, `PUT /scouts/:id` called.

### Entry Points

1. **Omnibar** — user types "monitor X for me", skill routes to `create_scout`
2. **Dedicated panel** — "New Scout" button opens a chat panel (reuses BrettThread pattern). Same skill underneath. After creation, navigates to the new scout's detail view.

---

## 6. UI Wiring

### API Hooks (`apps/desktop/src/api/`)

- `useScouts()` — `GET /scouts`, real-time via SSE
- `useScout(id)` — `GET /scouts/:id`
- `useScoutFindings(id)` — paginated `GET /scouts/:id/findings`
- `useScoutActivity(id)` — paginated `GET /scouts/:id/activity`
- `useScoutBudget()` — `GET /scouts/budget`
- Mutation hooks: create, update, pause, resume, dismiss, promote

### Component Changes

**ScoutsRoster:**
- Replace `mockScouts` with `useScouts()` data
- "New Scout" button opens ScoutCreationChat panel
- LeftNav badge count from real active scouts count

**ScoutDetail:**
- Replace mock data with `useScout(id)` + `useScoutFindings(id)`
- SensitivityPicker, CadencePicker, BudgetEditor → `PUT /scouts/:id` on save
- "Edit with Brett" fields → inline BrettThread with `create_scout` skill in edit mode
- Pause/Resume buttons → call endpoints
- Findings tab → real paginated data with dismiss/promote actions
- Activity Log tab → `useScoutActivity(id)`, interleaved runs + config changes
- FindingCard → "Dismiss" and "View in Inbox" actions

**ScoutCreationChat (new):**
- Similar to BrettThread, mounted on "New Scout" click
- Uses streaming omnibar infrastructure
- On creation complete, navigates to new scout detail

### SSE Events

- `scout:finding` — new finding, refresh findings list + badge count
- `scout:run` — run completed, refresh scout detail
- `scout:status` — status changed, refresh scout list

---

## 7. Budget Enforcement & Resets

### Per-Scout Budget

- `budgetUsed` incremented on each successful run only
- `budgetUsed >= budgetTotal` → runs skip with `ScoutRun(status: skipped)`
- When `budgetResetAt <= now`, reset `budgetUsed = 0`, advance `budgetResetAt` to next month

### Global Backstop

- `SCOUT_SYSTEM_BUDGET_MONTHLY` env var (e.g., 5000)
- Checked via: `SELECT COUNT(*) FROM ScoutRun WHERE status = 'success' AND createdAt >= startOfMonth`
- Over limit → all scouts skip. No user-facing error. Monitor via logs.

### Inbox Alerts

- **80% threshold** — create Item: "Scout '{name}' is running low on budget" with link to scout detail
- **100% exhausted** — create Item: "Scout '{name}' has paused — budget reached"
- One alert per threshold per month (tracked via ScoutActivity to avoid spam)

### End Date Expiry

- Cron tick checks `endDate <= now` on active scouts
- Set `status = expired`, log `ScoutActivity(type: expired)`
- Inbox notification: "Scout '{name}' has completed its mission"
