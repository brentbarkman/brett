# Scout Memory System

Scouts develop their own memory over time, improving judgment, tracking trends, and learning user preferences from feedback signals. Inspired by Claude Code's Dreams architecture — accumulate raw signal per run, periodically consolidate into durable memories via batch API.

## Data Model

### New Tables

#### ScoutMemory

| Field | Type | Notes |
|---|---|---|
| id | string (cuid) | PK |
| scoutId | string | FK → Scout, cascade delete |
| createdAt | DateTime | |
| updatedAt | DateTime | |
| type | enum: factual, judgment, pattern | Memory category |
| content | string (max 500) | LLM-generated memory text |
| confidence | float (0-1) | Strengthened/weakened over time |
| sourceRunIds | Json (string[]) | Which runs contributed |
| supersededBy | string? | FK → ScoutMemory (self-ref), null = active |
| supersededAt | DateTime? | When replaced |

Active memories: `WHERE scoutId = ? AND supersededBy IS NULL` ordered by confidence desc.

#### ScoutConsolidation

| Field | Type | Notes |
|---|---|---|
| id | string (cuid) | PK |
| scoutId | string | FK → Scout, cascade delete |
| createdAt | DateTime | |
| runsSinceLastConsolidation | int | Runs processed |
| memoriesBefore | int | Active memories before |
| memoriesAfter | int | Active memories after |
| memoriesCreated | int | New memories added |
| memoriesSuperseded | int | Old memories replaced |
| tokensUsed | int | Total |
| tokensInput | int? | Input tokens |
| tokensOutput | int? | Output tokens |
| modelId | string? | Model used |
| isBatch | boolean (default true) | Batch API vs regular |
| batchRequestId | string? | Anthropic batch API request ID |
| status | enum: pending, processing, completed, failed | Async status |

### Changes to Existing Tables

#### ScoutFinding — add fields

| Field | Type | Notes |
|---|---|---|
| feedbackUseful | boolean? | null = no feedback, true = useful, false = not useful |
| feedbackAt | DateTime? | When feedback was given |

#### ScoutFinding — remove fields

| Field | Notes |
|---|---|
| dismissed | Replaced by feedback signal; findings no longer dismissable from scout detail |

#### Scout — add fields

| Field | Type | Notes |
|---|---|---|
| consolidationRunCount | int (default 0) | Runs since last consolidation |
| consolidationThreshold | int (default 5) | Consolidate every N runs |
| lastConsolidatedAt | DateTime? | |

#### ScoutRun — add fields (granular token tracking)

| Field | Type | Notes |
|---|---|---|
| tokensInput | int? | Input tokens |
| tokensOutput | int? | Output tokens |
| modelId | string? | Model used (e.g., "claude-sonnet-4-6") |

Existing `tokensUsed` field kept for backwards compatibility (total).

### New Enums

```prisma
enum ScoutMemoryType {
  factual
  judgment
  pattern
}

enum ScoutConsolidationStatus {
  pending
  processing
  completed
  failed
}
```

## Feedback Signal Pipeline

### User Feedback Flow

1. User opens a scout-originated item in the item detail panel (TaskDetailPanel or ContentDetailPanel)
2. Below the existing "from {scoutName}" provenance line, two buttons appear: thumbs up / thumbs down
3. Neither selected by default — feedback is optional
4. Clicking one sends feedback to the API; clicking the same button again deselects (sets to null)
5. Button state persists across panel opens

### API Endpoint

```
POST /scouts/:id/findings/:findingId/feedback
Body: { useful: boolean | null }
Response: updated ScoutFinding
```

### What Consolidation Sees

Feedback is summarized for the consolidation prompt:

```
Findings since last consolidation: 12
- 3 marked useful: [titles, types, sources]
- 2 marked not useful: [titles, types, sources]
- 7 no feedback
```

The LLM synthesizes patterns ("user finds policy documents useful but not opinion pieces") rather than storing individual feedback events.

## Per-Run Memory Update

### Memory Injection

The existing judgment LLM prompt (step 6 in scout-runner.ts) gains a new section between `context` and search results:

```
## Your Memory
{active memories, ordered by confidence, up to ~1000 tokens}

Use this knowledge to inform your judgment. Do not re-discover things you already know.
```

### Memory Extraction

The judgment response schema is extended with one new field:

```json
{
  "findings": [...],
  "cadenceRecommendation": "maintain",
  "reasoning": "...",
  "memoryUpdates": [
    { "action": "create", "type": "factual", "content": "...", "confidence": 0.8 },
    { "action": "strengthen", "memoryId": "abc123", "confidence": 0.9 },
    { "action": "weaken", "memoryId": "def456", "confidence": 0.3 }
  ]
}
```

Three per-run actions:
- **create** — new memory from this run's findings
- **strengthen** — existing memory confirmed (bump confidence)
- **weaken** — existing memory contradicted (lower confidence)

No deletion at this stage — consolidation handles that.

### Cost Impact

No extra LLM call. Memory is injected into the existing judgment prompt (~1000 tokens added) and extracted from the same response.

### Run Count Tracking

After processing memory updates, increment `Scout.consolidationRunCount`. If it hits `consolidationThreshold`, fire consolidation (async batch API) and reset counter.

## Consolidation Pass

### Trigger

`Scout.consolidationRunCount >= Scout.consolidationThreshold` (default: every 5 runs).

### Consolidation Prompt Input

1. Scout identity — goal, context, sources
2. All active memories — current state
3. Feedback since last consolidation — useful/not-useful signals with finding details
4. Run summaries since last consolidation — findings, relevance scores, queries used
5. Instruction — "Synthesize into durable memories. Stay within ~1000 tokens of total memory."

### Output Schema

```json
{
  "memories": [
    { "action": "create", "type": "judgment", "content": "...", "confidence": 0.85 },
    { "action": "supersede", "memoryId": "abc123", "replacement": { "type": "factual", "content": "...", "confidence": 0.9 }},
    { "action": "keep", "memoryId": "def456" },
    { "action": "remove", "memoryId": "ghi789", "reason": "Contradicted by recent findings" }
  ]
}
```

Four consolidation actions:
- **create** — new synthesized memory
- **supersede** — replace existing with refined version (old gets `supersededBy` set)
- **keep** — retain unchanged
- **remove** — mark superseded with no replacement

### Batch API Flow

1. Runner hits threshold → create `ScoutConsolidation(status: pending)`, submit batch request, store `batchRequestId`
2. Existing `tickScouts()` cron (5-minute interval) polls pending consolidations via batch API status endpoint
3. Complete → process response, apply memory mutations, update to `status: completed` with token metrics
4. Failed → mark `status: failed`, don't reset run counter (retries at next threshold)

### Token Budget Hard Cap

After applying mutations, if active memories exceed ~1000 tokens, drop lowest-confidence memories by setting `supersededBy` to the consolidation ID. Safety net — the LLM should self-regulate, but this prevents unbounded growth.

## Memory Visibility UI

### Scout Detail Page — New "Memory" Tab

Third tab alongside Findings and Activity Log.

### Layout

Grouped by type (Factual Knowledge, Judgment & Preferences, Patterns & Trends), each section showing memories ordered by confidence descending.

### Memory Card

- Memory content text
- Type badge (factual / judgment / pattern)
- Confidence indicator (subtle bar or percentage)
- Relative time ("learned 3 days ago", "updated 1 day ago")
- Delete button on hover (same hover-reveal pattern as existing UI)

### Empty State

"This scout is still learning. Memories will appear after a few runs."

### Interaction

- View and delete only — no edit, no manual add
- Deleting a memory sets `supersededBy` to a sentinel value (or a dedicated "user_deleted" marker) so it's excluded from active queries but retains audit trail
- The `context` field on the scout handles manual user input

## Cleanup: Removing Dead Weight

### API Endpoints — Remove

- `POST /scouts/:id/findings/:findingId/dismiss`
- `POST /scouts/:id/findings/:findingId/promote`

### Database — Remove

- `ScoutFinding.dismissed` field

### UI — Remove

- `FindingCard` `onDismiss` and `onPromote` props and hover action buttons
- `useDismissFinding()` and `usePromoteFinding()` mutation hooks
- `.filter((f) => !f.dismissed)` in ScoutDetail findings rendering — show all findings

### Keep

- `ScoutFinding.itemId` — needed for finding → item linkage and feedback pipeline
- Auto-promote logic in scout runner (step 7) — findings still land in inbox as Items
- Scout provenance display on item detail panels

## Token Tracking

All LLM calls track granular token usage:

- **ScoutRun**: `tokensUsed` (total, backwards compat) + `tokensInput`, `tokensOutput`, `modelId`
- **ScoutConsolidation**: `tokensUsed`, `tokensInput`, `tokensOutput`, `modelId`, `isBatch`

The `isBatch` flag on consolidations enables accurate cost calculation (same tokens, 50% price via batch API).
