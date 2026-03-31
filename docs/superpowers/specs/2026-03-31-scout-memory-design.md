# Scout Memory System

Scouts develop their own memory over time, improving judgment, tracking trends, and learning user preferences from feedback signals. Inspired by Claude Code's Dreams architecture — accumulate raw signal per run, periodically consolidate into durable memories. Batch API is a future optimization; v1 uses synchronous LLM calls via the existing `AIProvider.chat()` path.

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
| sourceRunIds | Json (string[]) | Which runs contributed (see Population Rules below) |
| status | enum: active, superseded, removed, user_deleted | Memory lifecycle state |
| supersededBy | string? | ID of the memory that replaced this one (audit trail, not a FK constraint) |
| supersededAt | DateTime? | When replaced/removed |

Active memories: `WHERE scoutId = ? AND status = 'active'` ordered by confidence desc.

**sourceRunIds population rules:**
- Per-run creates: contains the current run's ID only
- Consolidation creates/supersedes: contains all run IDs processed in that consolidation cycle (runs since `lastConsolidatedAt`)

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
| isBatch | boolean (default false) | Batch API vs regular (v1 always false, future optimization) |
| batchRequestId | string? | Anthropic batch API request ID (future) |
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

Existing `tokensUsed` field kept for backwards compatibility (total). Modify `collectChatResponse()` in scout-runner.ts to return `{ text, tokensInput, tokensOutput, tokensUsed }` — the underlying `StreamChunk` done event already provides `usage.input` and `usage.output` separately.

### New Enums

```prisma
enum ScoutMemoryType {
  factual
  judgment
  pattern
}

enum ScoutMemoryStatus {
  active
  superseded
  removed
  user_deleted
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

### Data Path: Item → Finding

The item detail panels need to know the finding ID and current feedback state. Extend `ThingDetail` (the type used by detail panels) with:

- `scoutFindingId?: string` — the ScoutFinding that created this item
- `scoutFeedbackUseful?: boolean | null` — current feedback state

The items API resolves these by joining through `ScoutFinding WHERE itemId = item.id` when `source === 'scout'`. The detail panels use these fields to render button state and call the feedback endpoint.

### API Endpoint

```
POST /scouts/:id/findings/:findingId/feedback
Body: { useful: boolean | null }
Response: updated ScoutFinding
```

Same auth/ownership pattern as existing finding endpoints: validate `scoutId` matches the finding's `scoutId` and the authenticated user owns the scout.

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

The judgment function in scout-runner.ts (the `judgeResults` call that evaluates search results) gains a new prompt section between `context` and search results:

```
## Your Memory
[mem_abc123] (factual, confidence: 0.9) EU AI Act entered into force August 1, 2024
[mem_def456] (judgment, confidence: 0.8) User prefers policy documents over opinion pieces
[mem_ghi789] (pattern, confidence: 0.7) Coverage shifting from broad policy to sector-specific rules

Use this knowledge to inform your judgment. Do not re-discover things you already know.
```

Each memory is prefixed with its ID so the LLM can reference specific memories in its response. Token budget: ~1000 tokens, estimated at character count / 4.

### Memory Extraction

The existing `JUDGMENT_SCHEMA` (which uses `additionalProperties: false`) is extended with one new field — `memoryUpdates`:

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

**Validation:** All returned `memoryId` values must be validated — confirm they exist and belong to this scout. Skip invalid IDs silently.

`memoryUpdates` must be added to both `properties` and `required` in the `JUDGMENT_SCHEMA` (which uses `additionalProperties: false`). Empty array is the base case when the LLM has no memory updates.

### Cost Impact

No extra LLM call. Memory is injected into the existing judgment prompt (~1000 tokens added) and extracted from the same response.

### Run Count Tracking

After processing memory updates, atomically increment `Scout.consolidationRunCount`:

```sql
-- Use prisma.$queryRaw (not $executeRaw) to get the RETURNING value
UPDATE Scout SET consolidationRunCount = consolidationRunCount + 1
WHERE id = ? RETURNING consolidationRunCount
```

If the returned value equals `consolidationThreshold`, fire consolidation and reset counter. The atomic increment-and-check prevents race conditions from concurrent runs.

## Consolidation Pass

### Trigger

`Scout.consolidationRunCount >= Scout.consolidationThreshold` (default: every 5 runs).

### Consolidation Prompt Input

1. Scout identity — goal, context, sources
2. All active memories (with IDs) — current state
3. Feedback since last consolidation — useful/not-useful signals with finding details
4. Run summaries since last consolidation — findings, relevance scores, queries used
5. Instruction — "Synthesize into durable memories. Stay within ~1000 tokens of total memory (estimated at character count / 4)."

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
- **create** — new synthesized memory (status: active)
- **supersede** — replace existing with refined version (old memory → status: superseded, supersededBy: new memory ID)
- **keep** — retain unchanged
- **remove** — mark as removed (status: removed, no replacement needed)

**Validation:** All `memoryId` values validated against active memories for this scout. Invalid IDs skipped.

### Execution (v1: Synchronous)

V1 uses synchronous `AIProvider.chat()` — the same path as scout runs. The consolidation function runs as fire-and-forget after the scout run completes:

1. Runner hits threshold → create `ScoutConsolidation(status: pending)`, reset `consolidationRunCount` to 0
2. Call `AIProvider.chat()` with consolidation prompt
3. Process response → apply memory mutations → update consolidation to `status: completed` with token metrics
4. Failed → mark `status: failed` (consolidation will be retried when the next threshold is hit)

**Future optimization (batch API):** For Anthropic-provider users, consolidation can be submitted via the Messages Batch API for 50% cost savings. This requires adding a batch method to the Anthropic provider (bypassing the generic `AIProvider` abstraction since batch is Anthropic-specific) and a polling step in `tickScouts()`. The `isBatch` and `batchRequestId` fields on ScoutConsolidation support this future path.

### Token Budget Hard Cap

After applying mutations, count active memories. If total estimated tokens (character count / 4) exceed 1000, drop lowest-confidence memories by setting status to `removed`. Safety net — the LLM should self-regulate, but this prevents unbounded growth.

## Memory API Endpoints

All endpoints require auth via `authMiddleware`. Same ownership validation pattern as existing scout routes.

### List Active Memories

```
GET /scouts/:id/memories
Query: ?type=factual|judgment|pattern (optional filter)
Response: ScoutMemory[] (status = active, ordered by type then confidence desc)
```

### Delete Memory

```
DELETE /scouts/:id/memories/:memoryId
Effect: Sets memory status to user_deleted, supersededAt to now
Response: 204 No Content
```

### Get Consolidation History

```
GET /scouts/:id/consolidations
Response: ScoutConsolidation[] (ordered by createdAt desc, paginated)
```

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
- Deleting a memory calls `DELETE /scouts/:id/memories/:memoryId` which sets status to `user_deleted`
- The `context` field on the scout handles manual user input

## Cleanup: Removing Dead Weight

### API Endpoints — Remove

- `POST /scouts/:id/findings/:findingId/dismiss`
- `POST /scouts/:id/findings/:findingId/promote` (vestigial — all findings are auto-promoted at run time, promote endpoint is guarded by `if (finding.itemId) return conflict` and never reachable)

### Database — Remove

- `ScoutFinding.dismissed` field

### Backend Query Updates

Remove `{ where: { dismissed: false } }` from all `_count` queries in scouts.ts — this filter appears in:
- `GET /scouts` (findings count)
- `GET /scouts/:id` (findings count)
- `PUT /scouts/:id` (findings count)
- `POST /scouts/:id/pause` (findings count)
- `POST /scouts/:id/resume` (findings count)
- `GET /scouts/:id/findings` (total count)

### Type Updates

- Remove `dismissed: boolean` from `ScoutFinding` in `@brett/types`
- Add `feedbackUseful?: boolean | null` and `feedbackAt?: string` to `ScoutFinding` in `@brett/types`
- Add `scoutFindingId?: string` and `scoutFeedbackUseful?: boolean | null` to `ThingDetail` in `@brett/types`

### UI — Remove

- `FindingCard` `onDismiss` and `onPromote` props and hover action buttons
- `useDismissFinding()` and `usePromoteFinding()` mutation hooks
- `.filter((f) => !f.dismissed)` in ScoutDetail findings rendering — show all findings

### UI — Add

- `useScoutMemories(scoutId)` query hook
- `useDeleteScoutMemory()` mutation hook
- `useSubmitScoutFeedback()` mutation hook
- Memory tab component in ScoutDetail
- Feedback buttons in TaskDetailPanel and ContentDetailPanel

### Update Clear History

`DELETE /scouts/:id/history` must also delete `ScoutMemory` and `ScoutConsolidation` records for the scout, and reset `consolidationRunCount` to 0.

### Keep

- `ScoutFinding.itemId` — needed for finding → item linkage and feedback pipeline
- Auto-promote logic in scout runner — findings still land in inbox as Items
- `ScoutRun.dismissedCount` — still valid, describes sub-threshold results from the LLM judgment (not user-dismissed findings). Name is slightly misleading but changing it is a separate concern.
- Scout provenance display on item detail panels

## Token Tracking

All LLM calls track granular token usage:

- **ScoutRun**: `tokensUsed` (total, backwards compat) + `tokensInput`, `tokensOutput`, `modelId`
- **ScoutConsolidation**: `tokensUsed`, `tokensInput`, `tokensOutput`, `modelId`, `isBatch`

The `isBatch` flag on consolidations enables accurate cost calculation (same tokens, 50% price via batch API). V1 is always `false`.

Token estimation for memory budgeting uses character count / 4 as a rough heuristic. Exact tokenization is unnecessary for this purpose.
