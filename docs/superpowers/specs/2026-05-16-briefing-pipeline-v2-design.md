# Briefing Pipeline v2 — Personal-Assistant Rewrite

**Date:** 2026-05-16
**Status:** Approved, implementing
**Authors:** Brent + Claude (brainstorm session)

## Problem

The current daily briefing reads like a task summary, not a personal-assistant brief. Recent UX work (commits `0a7192b`, `d0df44c`, `15a683b`) replaced the bullet card with a 38pt serif editorial hero — but the generation prompt at `packages/ai/src/context/system-prompts.ts:48-82` still emits "3-5 bullet points" and the runtime collapses bullets to prose in the UI (`collapseToProse()`). The shape doesn't match the surface anymore, and the *content* still tells the user what they can already see at a glance.

Three concrete failure modes today:

1. **Tells you what's already visible.** "You have 3 overdue tasks. Start with X." — the inbox view shows this.
2. **Stale by 10am.** Generated once per local day. Sara moves your 2pm to 3:30; the brief doesn't know.
3. **Cheerful padding.** On quiet days, the model invents urgency rather than acknowledging the calm.

## Goals

- **PA voice, 30-second elevator brief.** 1-2 sentences max. Tells you things you can't see from a glance.
- **Updates as the day shifts.** Bootstrap in the morning; regenerate when signals arrive (new invite, meeting moved, high-signal newsletter, overdue threshold crossed); hard ceiling of 6 regens/day; 30-min floor between regens.
- **Coexists with NextUp.** The NextUp card already shows the next event title + countdown; the brief never duplicates that content.
- **Token-bounded.** Hard ceiling of ~$0.012/user/day, typical ~$0.006. Two-stage pipeline (cheap detector → focused writer) so the expensive model only sees pre-filtered, high-signal input.

## Non-goals

- Touching the NextUp card (stays non-AI, pure countdown).
- Touching Brett's Take (per-event commentary stays as-is).
- Multi-day briefing history (single latest brief per user is enough).
- Streaming the brief (it's 60-80 tokens — return JSON).

## Architecture

```
┌─ Signal collectors (cheap, deterministic, no LLM) ─────────────┐
│  calendar diff │ overdue threshold │ inbox scorer │ note RAG   │
└─────────────┬──────────────────────────────────────────────────┘
              │ Signal[] (~20-40 candidates, typed JSON)
              ▼
┌─ Stage 1: Haiku 4.5 detector ──────────────────────────────────┐
│  Input: signals + timeOfDay + nextUpVisible + lastBriefSignals │
│  Output: { empty: bool, picks: [{signalId, oneLiner, why}] }   │
│  ~400 in / ~120 out                                            │
└─────────────┬──────────────────────────────────────────────────┘
              │
       ┌──────┴──────┐
   empty=true    has picks
       │             │
       ▼             ▼
┌─ Template ─┐ ┌─ Stage 2: Sonnet 4.6 writer ──────────────────┐
│ Determin-  │ │ Input: ONLY the picks + style rules           │
│ istic line │ │ Output: 1-2 sentences, ≤80 tokens             │
│ (~25 tok)  │ │ ~300 in / ~60 out                             │
└──────┬─────┘ └─────────────┬─────────────────────────────────┘
       │                     │
       └──────────┬──────────┘
                  ▼
       Persist to UserBriefing row
```

## Signal collectors

Pure-function collectors that run in parallel before the detector. Each returns `Signal[]` or empty. They live in `apps/api/src/lib/briefing/collectors/`.

```ts
// shared
type Signal =
  | { id: string; type: "schedule_delta"; event: EventRef;
      change: "moved" | "cancelled" | "new"; details: string;
      occurredAt: ISO }
  | { id: string; type: "conflict"; events: EventRef[]; window: string }
  | { id: string; type: "prep_gap"; event: EventRef;
      lastTouchedDays: number | null; hasNotes: boolean }
  | { id: string; type: "overdue_threshold"; item: ItemRef;
      daysSlipped: number; crossedAt: ISO }
  | { id: string; type: "inbound"; source: "email" | "newsletter";
      subject: string; summary: string; score: number; arrivedAt: ISO }
  | { id: string; type: "meeting_context"; event: EventRef;
      relevantPriorNote: string; noteSource: string };

type EventRef = { id: string; title: string; startTime: ISO; durationMin: number };
type ItemRef  = { id: string; title: string; dueDate: ISO | null };
```

**Collector behaviors** — each one is bounded so total signal count stays under ~40:

| Collector | Source | Caps |
|---|---|---|
| `collectScheduleDeltas` | `CalendarEvent.updatedAt > lastBriefAt`, joined against an event-change log | Last 24h; max 8 |
| `collectConflicts` | Pairwise overlap on today/tomorrow events | Max 4 |
| `collectPrepGaps` | Events in next 8h with no `notes`, no attached item, last-touched > 7d if recurring | Max 4 |
| `collectOverdueThresholds` | Items crossing 1d or 3d boundary since `lastBriefAt` | Max 6 |
| `collectInbound` | Newsletters/emails ingested since `lastBriefAt` with `score ≥ 0.7` | Max 4 |
| `collectMeetingContext` | For up to the first 4 next-8h events, RAG against meeting-note embeddings; take top result per event if score > 0.75 | Max 4 queries, max 4 picks |

After all collectors run, the orchestrator caps the **combined** signal bundle at **top 15** by intrinsic priority (rough order: `schedule_delta` > `conflict` > `prep_gap` > `inbound` > `overdue_threshold` > `meeting_context`). This bounds detector input at ~600 tokens worst case.

Signal `id` is **stable per source event, not per occurrence** — format `{type}:{primaryRefId}[:{discriminator}]`. Examples:
- `schedule_delta:event_abc123:moved` (same event moved twice = same ID, second call updates the row in-place)
- `prep_gap:event_abc123` (one per event)
- `overdue_threshold:item_xyz:3d` (boundary is part of ID so 1d→3d crossing gets a new ID)
- `inbound:newsletter_def456`
- `meeting_context:event_abc123`

Stable IDs are what make the `priorBriefSignalIds` dedup actually work.

## Stage 1 — Detector (Haiku 4.5)

**Location:** new function `runBriefingDetector()` in `apps/api/src/lib/briefing/detector.ts`.

**System prompt** (in `packages/ai/src/context/system-prompts.ts`, new export `getBriefingDetectorPrompt()`):

```
You are the signal-judging stage of a personal-assistant briefing.
Input: a list of candidate signals about a user's day. Your job is to
return the 3-4 worth mentioning right now — or {empty: true} if NONE
of them is more useful than silence.

Quality rules (apply ruthlessly):
- REJECT any signal that duplicates `nextUpVisible` (the next event the
  user can already see on their Today view). E.g., if nextUpVisible
  shows "Q3 review with Sara at 1pm", reject `prep_gap` for that same
  event title unless the prep_gap adds NEW context.
- REJECT signals whose ID appears in `priorBriefSignalIds` unless the
  signal has materially changed since.
- REJECT `meeting_context` signals not tied to an event in the next 8h.
- PREFER signals whose `occurredAt` / `crossedAt` is after `lastBriefAt`
  ("what changed since last brief") over standing state.
- COLLAPSE multiple signals about the same event into a single pick
  (don't return three signals all about Sara's 2pm).
- BE WILLING to return {empty: true}. A quiet morning is not a failure.
  If the only signals are routine (no deltas, no inbound, no gaps),
  return empty.

Output: STRICT JSON, no markdown fences, no commentary. Schema:
{
  "empty": boolean,
  "picks": [
    { "signalId": string, "oneLiner": string, "why": string }
  ],
  "reason": string | null   // when empty, one short explanation
}

`picks` is [] when empty=true. `oneLiner` is the signal's essence in
≤15 words. `why` is one short clause explaining why this one mattered
(used by the writer for tone).
```

**Detector input shape:**
```ts
{
  timeOfDay: "morning" | "midday" | "afternoon" | "evening";
  nextUpVisible: { title: string; startsInMin: number } | null;
  lastBriefAt: ISO | null;
  priorBriefSignalIds: string[];
  signals: Signal[];
}
```

**Caller** — `runBriefingDetector(input)` calls `claude-haiku-4-5-20251001` with `max_tokens: 200`, JSON-mode if available, otherwise validate output against a Zod schema.

**Failure handling:**
- Malformed JSON → return `{ empty: true, reason: "detector_malformed" }`, log to `auditLog`, don't propagate.
- LLM timeout / 429 / 5xx → same as malformed: empty + template, log, don't propagate.

The detector input shape includes `nextUpVisible: null` whenever the next event is more than **8h away** (`startsInMin >= 480`), so the brief doesn't suppress signals about events the user can't actually see on the hero.

## Stage 2 — Writer (Sonnet 4.6)

**Location:** new function `runBriefingWriter()` in `apps/api/src/lib/briefing/writer.ts`.

**System prompt** (in `system-prompts.ts`, new export `getBriefingWriterPrompt()`):

```
You're a personal assistant giving a 30-second elevator briefing.
You will receive 1-4 pre-filtered signals. Write 1-2 sentences (≤80
tokens total) covering the most important ones. NEVER mention more
signals than fit naturally in 2 sentences — drop the weakest.

Hard rules:
- The user can already see this on their Today view: {nextUpVisible}.
  NEVER repeat its title or time. The brief adds context they CANNOT
  see at a glance.
- Do NOT list task counts ("you have 5 things", "3 overdue"). Those
  are visible in the UI.
- No fabrication: every claim must trace to a provided signal.
- No openers like "Good morning", "Heads up", "Quick note", "Just".
  The serif greeting above already greets. Start with substance.
- If signals describe a quiet day, say so plainly. One short sentence
  is better than two padded ones.

Voice: clipped, observational, never cheerful. A PA, not a coach.

Output: plain prose, no markdown, no quotes around event titles, no
bullets. 1-2 sentences. Done.
```

**Writer input shape:**
```ts
{
  timeOfDay: "morning" | "midday" | "afternoon" | "evening";
  nextUpVisible: { title: string; startsInMin: number } | null;
  picks: Array<{ oneLiner: string; why: string }>;
}
```

**Caller** — `runBriefingWriter(input)` calls `claude-sonnet-4-6` with `max_tokens: 110` (room for 80-token output + safety margin). On finish, hard-truncate at sentence boundary if >2 sentences. Strip leading "Good morning", "Heads up", etc. via deterministic regex (belt-and-suspenders against prompt drift).

**Failure handling:** LLM timeout / 429 / 5xx → fall back to the empty-state template (chosen as if detector had returned empty), log to `auditLog`, mark `isEmpty=true` and `lastTriggerSource="writer_failed"` so we can grep for it.

## Empty-state templates

When detector returns `empty: true`, skip Stage 2 entirely. Pick from a small fixed pool keyed by `(timeOfDay, eventCountToday)`:

```
morning + 0 events  → "Open day. Nothing on the calendar."
morning + 1 event   → "Quiet morning. Just {title} at {hh:mm}."
morning + >1 event  → "Calm so far — no overnight shifts."
midday + 0 remain   → "Afternoon's clear."
midday + 1 remain   → "Just {title} at {hh:mm} left."
midday + >1 remain  → "Steady afternoon ahead — no changes since this morning."
afternoon/evening   → "Wrapping up — nothing urgent."
```

**Template rule (load-bearing):** never interpolate `{title}` when NextUp is rendering that same event. Since NextUp renders whenever a confirmed upcoming event exists in the next 8h, the `{title}` variants only fire when `nextUpVisible === null` (no event within 8h). When NextUp is visible, the templates collapse to the title-less variants: `"Quiet morning."`, `"Calm so far."`, `"Steady afternoon."`.

Template selection rotates across an internal 3-line pool per `(timeOfDay, hasNextUp)` keyed by `hour % poolSize`, so two consecutive quiet days don't show the same line.

## Data model

New Prisma model, replaces the `conversationSession`-based briefing cache:

```prisma
model UserBriefing {
  userId                String   @id
  content               String   @db.Text
  isEmpty               Boolean  @default(false)
  signalsUsedIds        String[] // for next-regen dedup
  generatedAt           DateTime
  dirtyAt               DateTime?
  regenCountToday       Int      @default(0)
  regenDayKey           String   // "YYYY-MM-DD" in user-local TZ
  lastTriggerSource     String?
  updatedAt             DateTime @updatedAt

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([dirtyAt])  // for cron / sweep queries
}
```

**Migration**:
1. Create `UserBriefing` table.
2. Don't backfill — first request for each user lazily creates a row.
3. Leave the existing briefing path on `conversationSession` available behind the same `/briefing` GET endpoint for ONE deploy as a fallback if `UserBriefing` lookup misses. Remove in the follow-up cleanup PR.

Migration must use Prisma's standard transactional flow — no `CREATE INDEX CONCURRENTLY` (would break Prisma's transaction). The single B-tree index on `dirtyAt` is cheap.

## Endpoints

Replace `POST /brett/briefing/generate` (streaming) with:

```
GET  /brett/briefing/current
  Auth: required, rate 60/min
  Returns: {
    briefing: { content, isEmpty, generatedAt } | null,
    staleness: "fresh" | "dirty" | "capped"
  }
  Behavior: always returns the cached row instantly.
    - "fresh"  → row exists, dirtyAt <= generatedAt OR null
    - "dirty"  → dirtyAt > generatedAt AND regenCountToday < 6
                 AND (now - generatedAt) > 30min
    - "capped" → dirty but blocked by ceiling/floor

POST /brett/briefing/refresh
  Auth: required, rate 20/min
  Returns: 202 Accepted, empty body
  Behavior: fire-and-forget; spawns the pipeline. Server-side:
    1. Quick read of UserBriefing row WITHOUT a lock.
    2. If row says clean / capped / within-floor → return 202
       immediately, no work.
    3. Try `pg_try_advisory_xact_lock(hashtext('briefing:' || userId))`.
       If lock NOT acquired → another worker is already regenerating;
       return 202 immediately, no work.
    4. If lock acquired → re-read row inside the transaction (someone
       might have finished between steps 1 and 3). Re-check conditions.
       If still dirty → run collectors → detector → (writer or
       template) → UPDATE row → COMMIT (releases lock).
  Concurrent callers never block; at most one regen runs per user at
  a time; cost is bounded by 30-min floor + 6/day ceiling regardless
  of caller volume.
```

The old `POST /briefing/generate` endpoint stays one deploy as a thin wrapper that calls `POST /refresh` then returns the new content (for any in-flight client requests during deploy). Removed in cleanup PR.

`GET /briefing/summary` (the counts endpoint) stays untouched — used elsewhere in the UI.

## Refresh triggers

Triggers set `dirtyAt = NOW()` on `UserBriefing`. They do NOT call the pipeline — that happens lazily on next client `POST /refresh` after Today-view focus.

| Trigger | Wire location | Condition |
|---|---|---|
| **Morning bootstrap** | Hosted alongside existing periodic jobs (overdue scanner / connection-health checker — see `apps/api/src/lib/` for the existing pattern; do NOT spin up a new scheduler), runs every 5 min | For each user where `nowUserLocal ∈ [6:55, 7:05)` AND `regenDayKey != todayUserLocal` → set `dirtyAt = NOW()`, reset `regenCountToday = 0`, update `regenDayKey` |
| **Calendar delta** | `apps/api/src/routes/calendar-webhook.ts` (existing) | On any event create/update/cancel for today/tomorrow → set `dirtyAt` for that user |
| **Inbound high-signal** | `apps/api/src/lib/newsletter/ingest.ts` (existing) | After post-ingest classification, if `score >= 0.7` → set `dirtyAt` |
| **Overdue threshold** | Existing overdue scanner (or piggyback on overdue notification cron) | When an item crosses 24h or 3d overdue → set `dirtyAt` |

All triggers do a single tiny UPDATE — bounded cost, no fan-out, no LLM. Reasonable to call several times per minute on a busy day with no concern.

## Client behavior

**Desktop** (`apps/desktop/src/api/briefing.ts`):
- `useBriefing()` hook calls `GET /current` with `refetchOnWindowFocus: true` (so re-focusing the app picks up a brief that landed via cron while the user was elsewhere).
- On mount AND on window focus, if response `staleness === "dirty"` → `POST /refresh`, then schedule a single refetch of `/current` 2s later.
- No streaming. The query returns prose; `DailyBriefing.tsx` renders it as-is (drops `collapseToProse()` — the writer already outputs prose).

**iOS** (`apps/ios/Brett/Stores/BriefingStore.swift`):
- Existing store calls the briefing endpoint; update to use `GET /current`.
- On view appear AND on app foreground (`scenePhase == .active`), if `staleness == .dirty` → `POST /refresh`, then refetch after 2s.
- The updated row also arrives via sync pull (existing sync engine picks up the changed `UserBriefing` row), so multi-device stays consistent. **Add `UserBriefing` to the sync pull's table list** — without this the foreground refetch is the only way iOS sees updates, and brief drift across devices becomes possible.

Neither client blocks UI on the LLM — they render cached content immediately and refresh in the background.

## Evals

Archive `evals/briefing-quality.json` to `evals/_archive/briefing-quality-v1.json`. Add two new datasets.

### `evals/briefing-detector.json` — Stage 1 eval

~20 fixtures, each:
```json
{
  "name": "quiet_morning_should_be_empty",
  "input": { "timeOfDay": "morning", "nextUpVisible": null,
             "lastBriefAt": null, "priorBriefSignalIds": [],
             "signals": [/* routine non-newsworthy stuff */] },
  "expected": { "empty": true }
}
```

Categories: quiet morning, NextUp trap, recency bias, stale repeat rejection, top-N coherence (dedup same-event signals), dense morning (pick top 3), past-meeting context tied to next-8h event.

Pass condition (auto): picks' signal-ID set matches expected ±1 acceptable variance + correct `empty` flag.

### `evals/briefing-writer.json` — Stage 2 eval

~25 fixtures, each provides `picks` and expected behavior. Auto checks + LLM-as-judge.

**Auto checks (all must pass):**
- Sentence count ≤ 2
- Token count ≤ 80
- Does NOT contain `nextUpVisible.title` substring
- Does NOT match `/(you have|\bN\b) (tasks|items|things|overdue)/i`
- Does NOT start with `/^(good (morning|afternoon|evening)|heads up|quick|just)\b/i`

**LLM-as-judge (Sonnet 4.6, reusing `evals/judge.ts`):** 0-5 scoring across:
1. Fabrication (5 = every claim grounded in picks, 0 = invented)
2. Substantive lead (5 = first clause is strongest signal)
3. Voice fit (5 = clipped/observational, 0 = cheerful/coaching)
4. Quiet honesty (5 = on quiet fixtures, acknowledges quiet plainly)

Pass: all auto pass + mean LLM score ≥ 4.0/5.

### Pinned regression fixtures

These four MUST never fail; CI gates on them:
1. `nextup_duplication_trap` — input forces brief to either duplicate NextUp or skip it.
2. `task_count_trap` — many overdue items in signals; output must not say "N overdue".
3. `fabricated_urgency_trap` — empty signals + morning; must produce template, not invented urgency.
4. `cheerful_greeting_trap` — any input; output must not start with greeting.

### Eval cost

~45 fixtures × ($0.002 pipeline + $0.005 judge) ≈ **$0.30/run**. Cheap enough to run on every PR touching the briefing path.

## Token budget

| Stage | In | Out | Effective ¢ (warm cache) |
|---|---|---|---|
| Haiku detector | ~400 | ~120 | ~$0.0006 |
| Sonnet writer (~50% of regens) | ~300 | ~60 | ~$0.0013 |
| **Per regen avg** | | | **~$0.0013** |
| **Per user/day** (avg 3 regens, 50% empty) | | | **~$0.004** |
| **Per user/day** (ceiling — 6 regens, all writes) | | | **~$0.012** |

Compare to today: ~$0.005/user/day on Sonnet medium tier (700-1,200 tokens, 1 call). **Average cost is roughly flat; ceiling is bounded; quality jumps significantly.**

Update `docs/llm-call-audit.md` with new entry for the two-stage briefing pipeline.

## Risks & mitigations

- **Detector over-rejects.** Haiku might return `empty:true` too often on busy days, briefs go silent.
  *Mitigation:* eval rubric scores quiet-acknowledgment and over-rejection separately; tune prompt if observed.

- **Writer pads.** Sonnet still likes qualifiers ("It might be worth noting that...").
  *Mitigation:* 80-token hard cap (server-side truncate), regex auto-fail on banned openers, eval `voice fit` score.

- **Trigger storms.** Busy calendar day → 20+ webhook fires → 20× `UPDATE dirtyAt`.
  *Mitigation:* updates are cheap and idempotent; the 30-min floor + 6/day ceiling bound the *pipeline* runs regardless of trigger volume.

- **Stale brief on first deploy.** Existing users have no `UserBriefing` row.
  *Mitigation:* `GET /current` returns `briefing: null` on miss; client renders nothing visible (matches today's first-load behavior) and triggers refresh.

- **iOS sync drift.** If `UserBriefing` isn't added to sync pull, iOS keeps a stale brief.
  *Mitigation:* explicit step in the implementation plan; include in code review.

- **The empty-state template feels canned.** Same line every quiet day gets boring.
  *Mitigation:* rotate from the small fixed pool keyed by `(timeOfDay, hour, eventCountToday)` so two adjacent quiet days don't show the same line.

## Out of scope (deferred)

- Per-user voice tuning (e.g., "make briefs even more terse for me").
- Reasoning-trace UI ("why did Brett say this?").
- Push notification on high-signal regen ("Sara moved your 2pm").
- Mobile widget version.
- Per-trigger fine-grained debouncing (e.g., 5 calendar webhooks in 60s → single regen). Current 30-min floor implicitly handles this.

## Open implementation choices (defer to plan/implementation)

- Exact morning-bootstrap cron syntax (probably `*/5 * * * *` server-side, iterating users).
- Per-user mutex: Postgres advisory lock vs `SELECT FOR UPDATE` on the row. Lean toward the latter — fewer moving parts.
- Newsletter score threshold (`0.7` is a guess; measure on real ingest data after launch).
- Whether template rotation is hour-keyed or hour+state-keyed (probably hour+state — fewer collisions).
- Whether to keep the old `POST /briefing/generate` as a wrapper for one deploy or remove immediately (lean toward keep-one-deploy for in-flight client tolerance).
