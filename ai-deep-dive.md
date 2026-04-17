# Brett — AI Deep Dive

> Honest assessment of how Brett's AI works today, what's working well, and the highest-leverage improvements — both technical and functional. Pairs with [features.md](features.md), [architecture.md](architecture.md), and `docs/llm-call-audit.md`.

---

## 1. The shape of the system

Brett is **AI-native, not AI-bolted-on**: a single orchestration loop drives the omnibar, per-thing chat, daily briefing, Brett's Take, and (in a sibling pipeline) Scouts. Everything else (memory, embeddings, knowledge graph, fact extraction) feeds context *into* that loop or learns *from* it.

```
USER MESSAGE
  └─▶ assembleContext(input)            (system prompt + facts + profile + KG/RAG)
        └─▶ orchestrator.orchestrate()  (LLM stream, tool loop, tier escalation)
              ├─ FIRE_AND_FORGET tool? → flush confirmation, exit
              ├─ Tool call?            → execute skill, feed result back
              └─ Done                  → log usage, return
                    └─▶ async: extractFacts()       (small model, after threshold)
                                extractGraph()      (KG entities + relationships)
                                extractEntityFacts()
```

10 distinct LLM call sites. They're inventoried in `docs/llm-call-audit.md`. The orchestrator + assembler architecture means adding a new surface (e.g. "weekly review") is mostly a new `assembleX` branch, a system prompt, and a tier choice — the loop, security guards, usage logging, and tool surface come for free.

---

## 2. What's good (and worth defending)

### 2.1 Token economy is taken seriously

This is the single thing the codebase does best. Three concrete optimizations:

- **`toolMode` per surface** (`assembler.ts`): briefings and Brett's Take pass `toolMode: "none"` (no tool definitions in the request, ~2,500 fewer tokens per call). Omnibar uses `"contextual"` (~1,000 fewer tokens). Only the test/eval path uses `"all"`.
- **Intent-grouped tools** (`skills/registry.ts`): `toToolDefinitionsForMessage` runs five English-word-boundary regexes against the user message and only sends the matched groups. So "mark it done" only ships `mutate + LOOKUP_TOOLS` (4 tools) instead of all 31.
- **Fire-and-forget tools** (`orchestrator.ts:69`): `create_task`, `complete_task`, `move_to_list`, etc. — when *all* tool calls in a round are fire-and-forget, the orchestrator flushes the confirmations and **does not call the LLM a second time**. The skill's own `message` field is the user-facing response. Saves another ~2,500 tokens per action and an entire round-trip of latency.

Combined, an "add a task" omnibar interaction is on the order of one LLM round with a small model, vs. a naive design that'd be 2 rounds with full tool definitions on a medium model. Order-of-magnitude cheaper, and faster.

### 2.2 Tier escalation by tool complexity

The orchestrator starts at `small` for omnibar requests and escalates to `medium` only if the pending tool calls are *not* in `SIMPLE_TOOLS`. Complex requests (length > 80 chars, multiple action verbs, multi-turn) start at `medium`. Briefings start at `medium` (high-value, low-frequency); Brett's Take starts at `small` (cheap, frequent). This is the right shape.

### 2.3 Layered prompt-injection defense

Three independent layers:

- **Boundary tagging** — every piece of user-derived data goes inside `<user_data label="…">` blocks via `wrapUserData`. A shared "Security" block in the system prompt tells the model to treat content inside those tags as data, never instructions.
- **Tag breakout escaping** — `escapeUserContent` rewrites `</user_data>` → `&lt;/user_data&gt;` so a malicious string can't close the boundary tag and inject through the gap.
- **Validators on extraction outputs** — `validateFacts` (in `memory/validation.ts`) runs `INJECTION_PATTERN` (`ignore|override|system prompt|...`) and `TAG_INJECTION_PATTERN` against any LLM-extracted fact key/value, plus a category allowlist (`preference|context|relationship|habit`) and a key shape regex (`/^[a-z][a-z0-9_]{1,63}$/`). Same defenses on KG entity extraction.

This is mature. Most production Claude apps don't have this layered.

### 2.4 Hybrid retrieval done properly

`packages/ai/src/embedding/search.ts`:

- **Postgres FTS** with weighted `tsvector` (title=A, contentTitle=B, description=C, notes=D), `ts_rank_cd`, GIN-indexed generated columns.
- **Vector search** via pgvector with cosine distance (`<=>`) and a `DISTINCT ON ("entityType", "entityId")` to dedupe to the best chunk per entity.
- **Reciprocal Rank Fusion** (k=60) merges the two lists.
- **Voyage rerank** on top, gated by `AI_CONFIG.rerank.minCandidates` so we don't pay rerank cost on tiny result sets.
- **Graceful degradation** — vector search failure falls back to keyword-only with a logged error, not a request failure.

Hybrid + rerank is the right architecture and the failure modes are handled.

### 2.5 Memory is durable, structured, and supersedable

`UserFact` rows have category / key / value / `confidence` / `validity window` / `supersededBy`. `extractFacts` runs in a transaction: same-value upsert is a no-op, value change supersedes the old fact (sets `validUntil = now`, links via `supersededBy`) and creates a new one. Reads filter `validUntil: null`. This is closer to event-sourcing than a key-value store, which is the right call for personal context that drifts over time.

The 300-character user-text floor (`MIN_USER_TEXT_LENGTH`) before we bother extracting at all is a cheap, smart filter — most omnibar interactions are commands ("create task X") that contain no facts worth remembering.

### 2.6 Sane runtime guardrails

- `MAX_ROUNDS = 5` and `MAX_TOTAL_TOKENS` budget on the loop (with a graceful "_Response truncated_" sentinel when hit).
- `MAX_TOOL_RESULT_SIZE` truncation before tool results are appended to message history.
- `sanitizeError` redacts `sk-*`, `key-*`, `bearer …`, and high-entropy 40+-char alphanumeric strings before any error chunk is yielded to the client.
- Skill arguments validated against the skill's JSON Schema (`validateSkillArgs`) before execution.
- Per-user encrypted API keys (AES-256-GCM, `lib/encryption.ts`); failed validation auto-creates a "Reconnect Anthropic" task in Today (the connection-health pattern).
- AI usage logged at the round level into `AIUsageLog` with cache-creation/cache-read tokens broken out — cost and cache-hit telemetry is wired and queryable.

### 2.7 Eval harness exists

`evals/runner.ts` covers four suites: intent classification (with adversarial refusal cases), parameter extraction (fuzzy substring), briefing quality (LLM-judge with criteria), action item extraction. Runnable per-provider. Most personal projects don't have this.

---

## 3. Where it can be improved — technical

### 3.1 Prompt caching — enabled on both system+tools and multi-turn history

`providers/anthropic.ts` sets `cache_control` in two places: on the last tool definition (covers the full system + tools block), and on the last content block of the last message (covers the accumulating multi-turn history across tool rounds). `cacheCreationTokens` / `cacheReadTokens` are tracked per round in `AIUsageLog`. Uses 2 of Anthropic's 4 allowed breakpoints.

Anthropic's cache is content-keyed, so two omnibar requests from the same user with identical system + facts + tools automatically hit the same entry (5-minute TTL). The remaining class of cache misses is the user-facts block changing on every fact extraction — any time Brett learns something new, the cached prefix shifts and the next request re-creates it. Worth measuring `cacheReadTokens` / `cacheCreationTokens` ratio from `AIUsageLog` over a week to see if this is painful; if it is, the fix is to move the facts block *after* a cache breakpoint so the stable system prompt is cached independently.

### 3.2 Tool calls execute serially — make read tools parallel

In `orchestrator.ts:203`, `for (const tc of pendingToolCalls)` runs tool calls sequentially. For a request like "what's on today and what's in my inbox", the model emits two tool calls and we wait `list_today` → then `list_inbox`. Both are pure reads, no shared state.

Split the loop: collect the read-only skills, `Promise.all` them, then sequentially run any mutating ones. Most multi-tool rounds in practice are 2–3 reads — 30–60% latency reduction on those.

Mark each skill in `Skill` (in `skills/types.ts`) with `effect: "read" | "mutate"` so the orchestrator can plan correctly.

### 3.3 Intent classification is regex-only and English-only

`INTENT_PATTERNS` is five word-boundary regexes. It works but it's brittle:

- "snooze it 'til tomorrow" — `snooze` matches → mutate ✓
- "push it back" — no match → falls back to query+create+mutate
- Anything in another language — falls through entirely

We have a small-model LLM available; a one-call intent classifier with a fixed JSON output (`{intents: ["mutate", "query"]}`) would be more accurate at marginal cost (and we could skip it for high-confidence regex hits). Or: use the embedding provider to classify against canonical example phrases per intent — zero LLM cost, multilingual-by-default since Voyage embeddings cover 100+ languages.

### 3.4 No embedding-dimension or model-version tracking

Embeddings live in a single `Embedding` table with a fixed-width vector column. If we ever switch from OpenAI 1536 → Voyage 1024, or upgrade Voyage versions, **all stored embeddings become unusable** with no migration story, and there's no `model` / `dim` column on `Embedding` to even detect the mismatch at runtime.

Add `model` and `dim` columns to `Embedding`, scope queries by current model, and write a backfill job that re-embeds entities with the new model in the background. This is the kind of debt you only feel when you need to upgrade — by then it's already painful.

### 3.5 KG entity extraction has no canonicalization

`graph/extractor.ts` extracts entities by name. "Stephen", "Stephen Kim", "stephen kim" all become separate nodes. The graph quickly fragments. Two reasonable patches:

- After extraction, run a similarity check (embedding distance < threshold) against existing entities of the same `type` and merge.
- A weekly consolidation cron (already a pattern via `ScoutConsolidation` and `runConsolidation`) that proposes merges to the user via a small `KnowledgeEntity` review surface.

### 3.6 Fact extraction silently swallows per-fact errors

`memory/facts.ts:130` — `} catch {}`. A consistent failure (e.g., a constraint violation introduced by a schema change) would never surface. At minimum, log the error and a counter; better, surface it through the existing connection-health task pattern.

### 3.7 Skill output schema isn't validated

We validate skill *inputs* against JSON Schema, but skill *outputs* are typed as `SkillResult` with no runtime check. A skill that returns `{ success: true, data: undefined, message: "" }` will pass through and confuse the LLM in the next round. Add a thin output schema per skill (or at minimum a runtime invariant: `success === true → data !== undefined || message.length > 0`).

### 3.8 Brett-thread context drops session history

`assembleBrettThread` builds messages as just the current user message — by design (comment says "session history was ~2,000-3,000 tokens of low-value back-and-forth"). For long, evolving threads (e.g., "let's keep iterating on this email draft") the assistant loses turn-to-turn memory. A rolling summary at, say, every 6 messages — stored on `ConversationSession.summary` — would preserve continuity at a fraction of the token cost.

### 3.9 `mcp/granola.ts` is a deprecated stub

The real Granola integration is server-side at `apps/api/src/lib/granola-mcp.ts`. The stub at `packages/ai/src/mcp/granola.ts` is comment-marked deprecated and returns `null`. Delete it — it's confusing for future agents reading the AI package.

### 3.10 Vector search has no recency or diversity signal

Cosine similarity alone means stale duplicates can outrank fresh, more-relevant items. Two cheap improvements:

- Multiply the cosine score by a recency decay (e.g., `score * exp(-ageDays / 30)`) before RRF.
- Diversity penalty in the dedupe step — currently we keep the highest-similarity chunk per entity, but two near-duplicate entities can both pass through. MMR-style penalty would help.

### 3.11 Briefing tier is `small` — it shouldn't be

Briefing runs once a day per user. It's the highest-stakes single output (sets the tone of the day, feeds chat context). `medium` (or even `large` for a daily run) is justified at the per-day cost. Move `assembleBriefing` from `modelTier: "small"` to `medium`.

---

## 4. Where it can be improved — functional / product

### 4.1 Brett doesn't show its work

When the model runs three tool calls before answering, the user sees `tool_call` chips appear and disappear without context. A 2-line "I'm checking your calendar and inbox…" status banner during a multi-tool round (rendered from the tool name → human-readable mapping) would massively increase perceived intelligence and trust. Same for retrieval: when the assembler injects `embedding_context`, the chat could surface a collapsed "Used 3 past notes for context" disclosure.

### 4.2 No "undo" for fire-and-forget tool calls

`create_task`, `move_to_list`, `complete_task` execute and the conversation moves on. If Brett misroutes, the user goes hunting in the inbox. The fire-and-forget result already has `displayHint: { type: "confirmation", message }` — adding `undoToken: "<opaque>"` and a server endpoint `POST /undo/<token>` (valid for, say, 5 min) would make these actions reversible from the chat itself.

### 4.3 Brett's Take is one-shot

Per content item there's a single take. No way to ask "make it more concise" or "give me the bear case". Add a per-take refine UI that opens a tiny chat thread scoped to that item with the original take as the first assistant message.

### 4.4 Memory review surface exists, but is thin

Settings → Memory (`apps/desktop/src/settings/MemorySection.tsx`, backed by `GET/DELETE /api/memory/facts`) already lists active `UserFact` rows by category with a delete confirm. Good that it exists. What it doesn't yet show:

- **Confidence** — the column is on the record but not rendered. Low-confidence facts should be visually distinct so the user knows what to scrutinize.
- **Source** — "learned from conversation on 2026-04-12 at 3pm" builds trust. Today the row is just `{category, value}`.
- **Edit**, not just delete — if Brett misremembers "works at X" as "works at Y", the user wants to correct, not delete-then-wait-for-rediscovery.
- **Supersession history** — `supersededBy` links every revision; showing "previously: …" on each fact turns the page into a useful audit trail.

This is a 2–3 hour UI expansion of a surface that's already 80% there — high ROI since it's directly about the system being trustworthy.

### 4.5 Scout findings don't surface diffs

A scout watching a pricing page reports a finding when the page changes. The user gets the new content, not the diff. For "watch for changes" scouts, computing and showing a change summary ("Price increased from $X to $Y") via a small LLM call would be much higher signal than the raw new content.

### 4.6 Briefing is text-only

The output is good prose but everything is inline text. A structured "actionable" section at the bottom (Brett picks 3 highest-impact next moves, rendered as clickable task chips that pre-fill `create_task` or open the right thing) would shift it from "narration" to "command center".

### 4.7 Attachments aren't searchable

`Embedding.entityType` covers items, calendar events, meeting notes, scout findings, and conversations — not attachments. Long PDFs uploaded to a task (e.g., a contract, a research paper) are invisible to retrieval. Add an extraction step (PDF → text via a worker) and embed under `entityType: "attachment"`.

### 4.8 Multimodal input not surfaced

Anthropic and OpenAI both support image input. The omnibar accepts text only. A photo of a whiteboard, a screenshot, a receipt — all are first-class capture formats for a personal assistant. Plumbing this through the existing `provider.chat` interface (Message.content can already be array-of-blocks for both providers) is mostly a UI change.

### 4.9 Conversation drift isn't detected

If a single chat thread bounces from "schedule something" → "give me a status update" → "draft an email", the orchestrator treats it as one continuous context. A drift detector (embedding distance between consecutive user messages) could suggest "Start a new thread?" when topics shift hard, keeping each thread sharp.

---

## 5. Cost & performance napkin math

Today, using Anthropic Claude with no prompt caching, a typical omnibar interaction:

| Surface | Input tokens | Output tokens | Notes |
|---|---|---|---|
| Omnibar (simple, fire-and-forget) | ~1,200 (system + facts + profile + 1 tool def) | ~50 | 1 round, small model, no follow-up |
| Omnibar (search → answer) | ~1,200 + ~400 (tool result) | ~250 | 2 rounds, small → medium escalation |
| Brett thread (chat on a task) | ~1,800 (+ item context) | ~400 | medium, 1 round usually |
| Daily briefing | ~2,000 | ~250 | small (could be medium), 1 round |
| Brett's Take | ~1,200 | ~150 | small, 1 round, max 200 tokens |
| Fact extraction (async) | ~1,500 (conversation history) | ~150 | small |
| Scout judgment | ~3,000 (search results blob) | ~400 | small/medium |

The dominant cost is **input tokens** because of the system prompt + facts + profile preamble that ships with every call. **Anthropic prompt caching is already on** for the system + tools block and now extends to multi-turn message history as well. Most omnibar/chat traffic hits the cache after the first request in a 5-minute window.

Effective cost on a warm cache: ~120 fresh tokens + ~1,130 at 10% read price ≈ 233 effective input tokens per omnibar call — vs. ~1,250 full-price without caching. **~5× cheaper** for the same interactions. The bigger variable now is how often fact extraction rewrites the cached prefix (see §3.1).

---

## 6. The shortlist

If we can only pick five things to ship next, in order:

1. **Parallel read-only tool execution** (latency win, no cost change).
2. **"Brett is doing X" status during multi-tool rounds** (perceived intelligence + trust).
3. **Memory section expansion** — confidence + source + edit + supersession history (thin today; high ROI for trust).
4. **Embedding model/dimension columns** (debt that gets worse with time, cheap to fix now).
5. **Vector search recency decay + diversity** (quality; small change).

After those, the highest functional unlocks are: undo for fire-and-forget tool calls, attachment-text indexing, and multimodal input. Everything else is iteration on a fundamentally good engine.
