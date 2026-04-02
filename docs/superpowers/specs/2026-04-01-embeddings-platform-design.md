# Embeddings Platform Design

**Date:** 2026-04-01
**Status:** Draft
**Scope:** Universal embedding system — Brett-absorbed cost, no AI key required for core features

---

## Context

Brett currently uses substring matching (`ILIKE`) for search and has no concept of semantic similarity. The existing embedding infrastructure (`ConversationEmbedding` table, `OpenAIEmbeddingProvider`, pgvector with HNSW index) was built for conversation memory but is unused beyond a placeholder `recall_memory` skill.

This design transforms embeddings from a conversation-only experiment into a platform-wide system that makes Brett feel intelligent at every surface — even on the free tier without an AI key.

### Business Model Alignment

- **Free tier:** Embeddings included. Semantic search, related items, duplicate detection, meeting prep — all work without an AI key. Brett absorbs the embedding cost (~$0.01-0.05/user/month).
- **Paid tier (BYOK or future subscription):** AI features (chat, briefings, Brett's Take, scouts) gain context from embeddings — conversation recall, enriched briefings, smarter takes.
- **Strategic goal:** Embeddings are the free-tier differentiator. The product feels smart from day one. AI is the natural upgrade.

---

## Architecture Overview

### Core Concept: Universal Embedding Table

Replace the single-purpose `ConversationEmbedding` table with a universal `Embedding` table that can embed any entity in the system. Every embeddable entity gets a consistent `(entityType, entityId)` reference.

```
┌─────────────────────────────────────────────────────┐
│                    Embedding Table                   │
│─────────────────────────────────────────────────────│
│ id, userId, entityType, entityId, chunkIndex,       │
│ chunkText, embedding (vector), createdAt, updatedAt │
│─────────────────────────────────────────────────────│
│ entityType: item | calendar_event | meeting_note |  │
│             scout_finding | conversation            │
│ chunkIndex: 0 for single-chunk, 0..N for chunked    │
└─────────────────────────────────────────────────────┘
```

### Entity Types and What Gets Embedded

| Entity | Source Fields | Chunking Strategy | Trigger |
|--------|-------------|-------------------|---------|
| **Item (task)** | `title + description + notes` | Single chunk (concatenated, typically <500 tokens) | Create, update (title/description/notes) |
| **Item (content)** | `title + contentTitle + contentDescription` as chunk 0; `contentBody` as chunks 1..N | Chunk 0: metadata. Chunks 1+: body split at ~500 tokens with 50-token overlap | Create, content extraction complete |
| **CalendarEvent** | `title + description + location` | Single chunk | Calendar sync (create/update) |
| **MeetingNote** | `title + summary` as chunk 0; `transcript` (flattened) as chunks 1..N | Chunk 0: metadata+summary. Chunks 1+: transcript segments at ~500 tokens | Granola sync |
| **ScoutFinding** | `title + description + reasoning` | Single chunk (concatenated) | Scout run creates finding |
| **Conversation** | User + assistant messages concatenated | Single chunk (truncated to 8000 chars, existing behavior) | Post-conversation (requires AI key — this is the one entity that only embeds when AI is active) |

### Embedding Provider: Voyage AI (Brett-Owned Key)

- **Provider:** Voyage AI `voyage-3-large` (1024 dimensions)
- **Why Voyage:** Best retrieval quality (MTEB leader), explicit asymmetric search support (`input_type: "query"` vs `"document"`), competitive cost ($0.06/1M tokens)
- **Asymmetric embedding:** The `EmbeddingProvider` interface gains an `inputType` parameter. Entities are embedded as `"document"` at write time. Search queries and similarity lookups are embedded as `"query"` at read time. This improves quality on the 8 out of 12 vector operations that are asymmetric (short query → longer document).
- Brett's API server holds a single Voyage API key in `EMBEDDING_API_KEY` env var
- This key is used for ALL embedding operations — users never need their own key for embeddings
- The `VoyageEmbeddingProvider` is instantiated once at server startup with this key
- Cost absorbed by Brett as infrastructure (~$540/month at 10K users)

### EmbeddingProvider Interface Change

```typescript
export interface EmbeddingProvider {
  embed(text: string, inputType?: "query" | "document"): Promise<number[]>;
  readonly dimensions: number;
}
```

- `inputType: "document"` — used when embedding entities for storage (items, events, findings, etc.)
- `inputType: "query"` — used when embedding search queries or similarity lookup inputs
- Providers that don't support asymmetric modes (e.g., OpenAI) ignore the parameter
- Default: `"document"` (safe default — most calls are entity embedding)

### Key Design Decisions

**1. One table, not per-entity tables.** A universal `Embedding` table with `entityType` discriminator means one search query spans all content types. The alternative (separate tables per entity) would require UNION queries and complicate the search API.

**2. Chunk index for large content.** Content bodies and meeting transcripts can be large. We chunk them and store each chunk as a separate row with `chunkIndex`. Short content (tasks, events, findings) gets a single row at `chunkIndex = 0`. This means search results point to specific chunks, enabling snippet display.

**3. Hybrid search (keyword + vector).** Pure vector search misses exact matches (task IDs, specific names, dates). Pure keyword search misses semantic matches. We run both in parallel and merge results using reciprocal rank fusion (RRF). The API endpoint handles this transparently.

**4. Async embedding pipeline.** Embeddings are generated asynchronously after entity creation/update. The user never waits for an embedding to complete. A background job queue processes embedding requests. If the embedding service is down, items still save — embeddings catch up later.

**5. Auto-link threshold: hybrid approach.** Cosine similarity > 0.90 → auto-create `ItemLink` with `source = "embedding"`. Between 0.75-0.90 → return as suggestions. Below 0.75 → discard. Thresholds are configurable in `AI_CONFIG` for tuning against real data.

---

## Data Model Changes

### New: `Embedding` Table

```prisma
model Embedding {
  id         String   @id @default(cuid())
  userId     String
  user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  entityType String   // "item" | "calendar_event" | "meeting_note" | "scout_finding" | "conversation"
  entityId   String   // FK to the source entity (not enforced — polymorphic)
  chunkIndex Int      @default(0)  // 0 for single-chunk entities, 0..N for chunked
  chunkText  String   @db.Text     // the text that was embedded
  embedding  Unsupported("vector(1024)")
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  @@unique([entityType, entityId, chunkIndex]) // one embedding per chunk per entity
  @@index([userId])
  // HNSW index created via raw SQL in migration
}
```

### Modified: `ItemLink`

Add a `source` field to distinguish auto-links from manual links:

```prisma
model ItemLink {
  // ... existing fields ...
  source     String   @default("manual") // "manual" | "embedding"
}
```

### Deprecated: `ConversationEmbedding`

The existing `ConversationEmbedding` table is superseded by the universal `Embedding` table (with `entityType = "conversation"`). Migration will:
1. Copy existing rows to `Embedding` with `entityType = "conversation"`, `entityId = sessionId`, `chunkIndex = 0`
2. Drop `ConversationEmbedding` table

### Config Additions

```typescript
// AI_CONFIG additions
embedding: {
  provider: "voyage",
  model: "voyage-3-large",
  dimensions: 1024,
  maxChunkTokens: 500,       // target chunk size
  chunkOverlapTokens: 50,    // overlap between chunks
  maxTextLength: 8000,        // absolute max per chunk (chars)
  autoLinkThreshold: 0.90,    // above this → auto-link
  suggestThreshold: 0.75,     // above this → suggest
  searchResultLimit: 20,      // max results per search
  batchSize: 50,              // max items per batch embed call
}
```

---

## Embedding Pipeline

### Architecture

```
Entity Created/Updated
        │
        ▼
  Embedding Queue          ◄── In-process async queue (not Redis/external)
        │                      Debounces rapid updates (500ms)
        │                      Retries on failure (3x, exponential backoff)
        ▼
  Text Assembly            ◄── Concatenate relevant fields per entity type
        │                      Chunk if > maxChunkTokens
        ▼
  Voyage AI API             ◄── Brett-owned key (EMBEDDING_API_KEY)
        │                      inputType: "document" for entities, "query" for searches
        │                      Batch API: up to 50 texts per call
        ▼
  Upsert Embedding         ◄── INSERT ... ON CONFLICT (entityType, entityId, chunkIndex)
        │                      UPDATE SET embedding, chunkText, updatedAt
        ▼
  Post-Embed Hooks         ◄── Auto-link check (if item)
                               Duplicate detection (if new item)
```

### Text Assembly Rules

Each entity type has a text assembler that produces the string(s) to embed:

**Item (task):**
```
[Task] {title}
{description || ""}
{notes || ""}
```

**Item (content):**
```
Chunk 0: [Content: {contentType}] {title} — {contentTitle || ""} — {contentDescription || ""}
Chunk 1..N: {contentBody chunked at ~500 tokens with 50-token overlap}
```

**CalendarEvent:**
```
[Meeting] {title}
{description || ""}
Location: {location || ""}
```

**MeetingNote:**
```
Chunk 0: [Meeting Notes] {title} — {summary || ""}
Chunk 1..N: {transcript flattened to "speaker: text" lines, chunked}
```

**ScoutFinding:**
```
[Scout Finding] {title}
{description}
Relevance: {reasoning}
```

**Conversation:**
```
{existing behavior — user/assistant messages concatenated, truncated to 8000 chars}
```

The prefix tags (`[Task]`, `[Meeting]`, etc.) help the embedding model distinguish content types in the same vector space, improving cross-type search quality.

### Chunking Algorithm

For `contentBody` and `transcript` fields that exceed `maxChunkTokens`:

1. Split text on paragraph boundaries (`\n\n`) first
2. If a paragraph exceeds `maxChunkTokens`, split on sentence boundaries (`. `)
3. Accumulate paragraphs/sentences into chunks until approaching `maxChunkTokens`
4. Each chunk overlaps with the previous by `chunkOverlapTokens` (repeat last ~50 tokens of previous chunk)
5. Cap at `maxTextLength` chars per chunk as a safety limit

### Triggers

| Event | What Gets Embedded | How |
|-------|-------------------|-----|
| `POST /api/things` (item created) | The new item | Queue embed job |
| `PATCH /api/things/:id` (item updated — title, description, or notes changed) | The updated item | Queue embed job (debounced) |
| Content extraction completes (`contentStatus → "extracted"`) | Item re-embedded with content fields + body chunks | Queue embed job |
| Calendar sync (event created/updated) | The event | Queue embed job |
| Granola sync (meeting note created/updated) | The meeting note | Queue embed job |
| Scout run creates finding | The finding | Queue embed job |
| AI conversation ends (post-response hook) | The conversation | Queue embed job (requires AI to be active — this is the only trigger that depends on AI key) |
| Bulk import (future) | All imported items | Batch embed job |

### Backfill

On first deploy, existing data needs embeddings. A backfill job:

1. Queries all Items, CalendarEvents, MeetingNotes, ScoutFindings without embeddings
2. Assembles text for each
3. Batches into groups of 50 (OpenAI batch embedding API)
4. Inserts embeddings
5. Runs at low priority (rate-limited to avoid API throttling)
6. Progress tracked via a simple `BackfillStatus` record or log output

For a user with 500 items, 200 events, and 100 findings, backfill costs ~$0.001 and takes ~30 seconds.

### Deletion

When an entity is deleted, its embeddings are deleted. This happens via:
- Cascade: if we add a proper FK (only possible for entities in the same DB)
- Explicit cleanup: embedding deletion in the same transaction as entity deletion

Since `entityId` is polymorphic (no FK constraint), we use explicit cleanup:

```typescript
// In item delete handler
await prisma.$transaction([
  prisma.embedding.deleteMany({ where: { entityType: "item", entityId: id } }),
  prisma.item.delete({ where: { id } }),
]);
```

### Update Semantics

When an entity's text fields change, we re-embed. The `@@unique([entityType, entityId, chunkIndex])` constraint allows upsert:
- If chunk count decreases (e.g., content body shortened), delete orphaned chunks with `chunkIndex > newMaxIndex`
- If chunk count increases, new chunks are inserted

---

## Search System

### Hybrid Search Architecture

```
User Query
    │
    ├──► Keyword Search (existing ILIKE)     ──► Keyword Results (ranked by relevance)
    │                                              │
    ├──► Vector Search (embed query → pgvector) ──► Vector Results (ranked by similarity)
    │                                              │
    └──────────────────────────────────────────────►  Reciprocal Rank Fusion
                                                            │
                                                            ▼
                                                     Merged Results
                                                     (deduplicated, re-ranked)
```

### API Endpoint

```
GET /api/search?q=<query>&types=item,calendar_event&limit=20
```

**Parameters:**
- `q` (required): search query string
- `types` (optional): comma-separated entity types to search. Default: all types.
- `limit` (optional): max results. Default: 20, max: 50.
- `listId` (optional): filter items to a specific list

**Response:**
```typescript
interface SearchResult {
  entityType: "item" | "calendar_event" | "meeting_note" | "scout_finding";
  entityId: string;
  title: string;         // display title
  snippet: string;       // matching chunk text (truncated)
  score: number;         // fused relevance score (0-1)
  matchType: "keyword" | "semantic" | "both";
  // Entity-specific metadata:
  metadata: {
    status?: string;     // item status
    dueDate?: string;    // item due date
    listName?: string;   // item list name
    startTime?: string;  // event start time
    scoutName?: string;  // finding's scout name
    contentType?: string; // content item type
  };
}
```

### Reciprocal Rank Fusion (RRF)

RRF merges two ranked lists without needing comparable scores:

```
RRF_score(d) = Σ  1 / (k + rank_in_list_i)
               i
```

Where `k = 60` (standard constant). A document appearing in both lists gets scores from both, naturally boosting it.

**Implementation:**
1. Run keyword search → get top 30 results with ranks
2. Run vector search → get top 30 results with ranks
3. For each unique entity across both lists, compute RRF score
4. Sort by RRF score descending
5. Return top `limit` results

### Omnibar / Spotlight Integration

The Omnibar and Spotlight currently call `GET /api/things?search=...` for keyword search. Changes:

1. Add a new `GET /api/search` endpoint (hybrid search)
2. Omnibar/Spotlight call `/api/search` instead of `/api/things?search=`
3. Results include all entity types (items, events, meetings, findings) — the UI renders each type with its appropriate component
4. The existing `?search=` param on `/api/things` remains for backward compatibility and list-scoped searches

### Search Performance

- **pgvector HNSW index** on the `Embedding` table (already proven with `ConversationEmbedding`)
- **User-scoped queries** (`WHERE userId = ?`) reduce the search space dramatically
- **Parallel execution**: keyword and vector searches run concurrently
- **Expected latency**: keyword ~5ms + vector ~15ms + fusion ~1ms = ~20ms total for a typical user (< 5,000 embeddings)
- **At scale (100K+ embeddings per user)**: HNSW still sub-50ms. If needed, add IVFFlat index as a secondary option.

---

## Use Case Implementations

### 1. Semantic Search (Omnibar + Spotlight)

**Endpoint:** `GET /api/search`
**Frontend:** Omnibar.tsx and SpotlightModal.tsx call the new search endpoint
**Behavior:** Type-ahead triggers search after 2+ characters with 300ms debounce. Results grouped by entity type.
**Fallback:** If embedding service is unavailable, falls back to keyword-only search transparently.

### 2. Related Items (Hybrid Auto-Link + Suggestions)

**Trigger:** After embedding an item (post-create or post-update)
**Process:**
1. Query `Embedding` for the same user, excluding the current item, entity type = "item"
2. Rank by cosine similarity
3. Similarity > 0.90 → auto-create `ItemLink` with `source = "embedding"`, bidirectional
4. Similarity 0.75-0.90 → store as suggestions (returned via API, not persisted as links)
5. Similarity < 0.75 → discard

**API:**
- `GET /api/things/:id` already returns links. Auto-links appear with `source: "embedding"` so the UI can distinguish them (subtle visual treatment, one-click unlink).
- New: `GET /api/things/:id/suggestions` → returns suggested related items (0.75-0.90 range) that the user can promote to links.

**UI:**
- Detail panel shows two sections: "Linked" (manual + auto) and "Suggested" (embeddings below auto-link threshold)
- Auto-links show a small indicator (e.g., a subtle "Brett linked" label)
- User can unlink auto-links with one click (deletes the `ItemLink`)
- User can promote suggestions to links with one click (creates `ItemLink` with `source = "manual"`)

### 3. Duplicate Detection

**Trigger:** After embedding a new item
**Process:**
1. Query for items with cosine similarity > 0.85 (tighter than auto-link since this is about near-identical content, not relatedness)
2. If matches found, return them in the create response
3. Frontend shows a non-blocking toast: "This looks similar to: [item title]. View?"

**API change:** `POST /api/things` response gains an optional `duplicateCandidates` field:
```typescript
{
  item: { ... },  // the created item
  duplicateCandidates?: Array<{ id: string; title: string; similarity: number }>
}
```

**Scope:** Only checks against items (not events, meetings, or findings).

### 4. List Assignment Suggestions

**Concept:** Pre-suggest the most relevant list during triage based on semantic similarity to existing list content.

**Implementation:**
- Maintain a cached "list centroid" — the average embedding of all active items in each list
- When triaging an item, compare its embedding against all list centroids
- Return top 2 suggestions sorted by similarity

**Centroid computation:**
- Computed on demand with caching (invalidate when items added/removed from list)
- Stored in memory (not DB) — it's a derived value, fast to recompute
- For a list with 50 items, centroid = `AVG(embedding)` via SQL aggregation on pgvector

**API:** `GET /api/things/:id/list-suggestions` → `[{ listId, listName, similarity }]`

### 5. Calendar Event → Related Tasks

**Trigger:** When viewing a calendar event detail panel
**Process:** Embed the event (already done at sync time), query for similar items
**API:** `GET /api/events/:id/related-items` → returns items ranked by embedding similarity
**Threshold:** > 0.70 (lower than auto-link since cross-entity-type matches are inherently less precise)

### 6. Recurrent Meeting Context

**Concept:** For recurring meetings, Brett accumulates context across instances. When preparing for the next occurrence, the user sees a rich history.

**How it works:**
1. Calendar events with the same `recurringEventId` (from Google Calendar) are identified as recurrences of the same meeting
2. When viewing an upcoming recurrence, query for:
   - Past calendar events with the same `recurringEventId`
   - Meeting notes linked to those past events
   - Items (tasks) linked to those past events or created from their action items
3. Assemble a "meeting history" that shows: topics discussed, action items created, what's still open

**API:** `GET /api/events/:id/meeting-history` → returns:
```typescript
{
  recurringEventId: string;
  pastOccurrences: Array<{
    eventId: string;
    date: string;
    meetingNote?: { title: string; summary: string };
    actionItems: Array<{ itemId: string; title: string; status: string }>;
  }>;
  // Semantically related items (via embeddings) that aren't directly linked
  relatedItems: Array<{ id: string; title: string; similarity: number }>;
}
```

**Embedding role here:** The `relatedItems` field uses embeddings to find tasks/content related to the meeting topic that weren't explicitly created from the meeting. This catches prep material: "You saved an article about retention metrics — your upcoming 1:1 with Jordan often discusses churn."

### 7. Scout Finding Deduplication

**Trigger:** During scout run, after finding generation but before storage
**Process:**
1. Embed each candidate finding
2. Compare against existing findings for this scout AND across all user scouts
3. If similarity > 0.88 with an existing finding → mark as duplicate, skip storage
4. Log dedup in scout run metadata for transparency

**Integration point:** `apps/api/src/lib/scout-runner.ts`, in the judgment/storage phase.

### 8. Content Body Search

**Handled by:** The universal search system. Content items with `contentBody` get multiple chunks (chunk 0 = metadata, chunks 1+ = body segments). When a search matches a body chunk, the result links to the parent item with the matching chunk as the snippet.

**No separate implementation needed** — this falls out naturally from the chunking strategy + hybrid search.

---

## AI-Enhanced Use Cases (Require AI Key)

These build on the embedding infrastructure but require the user's AI key for LLM calls.

### 9. Conversation Memory Recall (Layer C)

**Change to context assembler:** Add `loadRelevantMemories()` step:
1. Embed the current user message
2. Query `Embedding` where `entityType = "conversation"` and `userId = current user`
3. Return top 3 results above similarity 0.70
4. Inject into system prompt as `<user_data label="past_conversations">`

**The `recall_memory` skill:** Wire to `searchSimilar()` (which now uses the universal `Embedding` table). No longer a placeholder.

### 10. Enriched Morning Briefing

**Change to briefing context assembly:**
1. Embed today's agenda (concatenated task titles + event titles)
2. Find semantically similar completed tasks, past meeting notes, old content items
3. Include top 3 relevant historical items in the briefing prompt
4. The LLM can reference them naturally: "You have a meeting about X — you last discussed this on [date]"

### 11. Smarter Brett's Take

**Change to Brett's Take context assembly:**
1. Embed the target item/event
2. Find similar past items (completed tasks, old content)
3. Include in the take prompt: what happened with similar items, how long they took, whether they were deferred
4. The take becomes informed by history, not just the current item

### 12. Scout Context Enhancement

**Change to scout runner:**
1. Before generating search queries, embed the scout's goal
2. Find semantically related items in the user's collection
3. Include top 5 relevant items as context in the scout's judgment prompt
4. Findings become more personally relevant

### 13. Meeting Prep (AI-Enhanced, Recurrent Focus)

**Builds on use case #6 (recurrent meeting context).**
When the user asks Brett about an upcoming meeting (via thread or omnibar):
1. Load the meeting history (use case #6)
2. Load semantically related items (via embeddings)
3. The LLM synthesizes: "Your 1:1 with Jordan — last 3 meetings covered hiring, Q3 metrics, and the platform migration. You have 2 open tasks from the last meeting. Related: you saved an article about engineering hiring benchmarks."

### 14. AI-Validated Auto-Linking

**Enhancement to use case #2:**
For items in the suggestion range (0.75-0.90), optionally pass them to the LLM to validate the relationship:
- "Is [Task A] genuinely related to [Task B]?"
- If the LLM confirms, promote to auto-link
- If the LLM rejects, drop the suggestion

**Trigger:** Only on user request ("Why is this suggested?") or as a background quality pass — not on every item creation. This keeps LLM costs predictable.

---

## Server-Side Embedding Key Management

### Environment Variable

```
EMBEDDING_API_KEY=pa-...   # Brett-owned Voyage AI API key for embeddings
```

- Set in Railway environment (production) and `.env` (development)
- Added to `.env.example` with a placeholder
- The `VoyageEmbeddingProvider` is instantiated once at server startup, not per-request
- If `EMBEDDING_API_KEY` is not set, embedding features degrade gracefully (keyword-only search, no related items, no dedup)

### Cost Monitoring

- Track embedding API usage via a lightweight counter (daily token count)
- Log to `AIUsageLog` with `source = "embedding"`, `provider = "voyage"`, `model = "voyage-3-large"`
- The admin panel can display embedding costs alongside user AI costs
- Alert threshold: configurable (e.g., warn if daily embedding cost exceeds $X)

### Rate Limiting

- Voyage AI rate limits vary by plan — monitor via response headers
- Batch embedding (up to 50 texts per call) keeps RPM low
- Backfill uses a slower rate (10 RPM) to avoid competing with real-time embeddings
- If rate limited, queue retries with exponential backoff

---

## Migration Strategy

### Phase 1: Schema + Infrastructure + Test Foundation

1. Create `Embedding` table (1024 dims) with HNSW index via Prisma migration
2. Add `source` field to `ItemLink`
3. Migrate existing `ConversationEmbedding` data → `Embedding` table (re-embed at 1024 dims)
4. Drop `ConversationEmbedding` table
5. Build `VoyageEmbeddingProvider` implementing updated `EmbeddingProvider` interface (with `inputType` param)
6. Build `MockEmbeddingProvider` with semantic clusters (test foundation for all subsequent phases)
7. Add `EMBEDDING_API_KEY` to environment
8. Update `AI_CONFIG` with new embedding config block

### Phase 2: Embedding Pipeline

1. Build text assemblers for each entity type (with `[Task]`, `[Meeting]`, etc. prefix tags)
2. Build chunking algorithm (paragraph → sentence splitting, overlap)
3. Build async embedding queue (in-process, debounced, retry with backoff)
4. Wire triggers (item create/update, content extraction, calendar sync, etc.) — all use `inputType: "document"`
5. Build backfill job for existing data
6. Update `embedConversation()` to use new `Embedding` table
7. Unit tests for assemblers + chunking, integration tests for pipeline

### Phase 3: Search

1. Build `GET /api/search` endpoint with hybrid search (keyword + vector + RRF) — vector queries use `inputType: "query"`
2. Update Omnibar and Spotlight to use new search endpoint
3. Render multi-type results in the UI
4. Integration tests for hybrid search (keyword-only, vector-only, merged results)

### Phase 4: Related Items + Auto-Linking

1. Build post-embed hook for auto-link detection
2. Add `GET /api/things/:id/suggestions` endpoint
3. Update detail panel UI: auto-links with indicator, suggestions section
4. Build duplicate detection in `POST /api/things`

### Phase 5: Calendar + Meeting Prep

1. Build `GET /api/events/:id/related-items`
2. Build `GET /api/events/:id/meeting-history` (recurrent meeting context)
3. Update calendar event detail panel UI

### Phase 6: List Suggestions + Scout Dedup

1. Build list centroid computation and caching
2. Build `GET /api/things/:id/list-suggestions`
3. Update triage UI with list suggestions
4. Integrate semantic dedup into scout runner

### Phase 7: AI-Enhanced Features (Requires AI Key)

1. Wire `recall_memory` skill to universal search
2. Add embedding context to briefing assembler
3. Add embedding context to Brett's Take assembler
4. Add embedding context to scout runner
5. AI-validated auto-linking (optional enhancement)

---

## Testing Strategy

### Layer 1: MockEmbeddingProvider (Unit Tests)

A deterministic mock provider that returns predictable vectors for testing. Built as a **Phase 1 deliverable** — every subsequent phase writes tests using it.

**Design:**
```typescript
class MockEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions = 1024;

  // Semantic clusters: predefined vectors where similar texts
  // have known, stable cosine similarities
  private clusters: Map<string, number[]>;

  // Fallback: hash-based deterministic vectors for unknown text
  embed(text: string, inputType?: "query" | "document"): Promise<number[]>;
}
```

**Semantic clusters for threshold testing:**
- **Cluster A ("finance"):** "budget review", "Q3 financials", "revenue forecast" → pairwise similarity 0.88-0.95
- **Cluster B ("hiring"):** "engineering hiring", "interview pipeline", "recruiter sync" → pairwise 0.85-0.92
- **Cross-cluster A↔B:** similarity ~0.40-0.55 (related domains, different topics)
- **Outlier:** "dentist appointment" → similarity < 0.30 to everything
- **Near-duplicate pair:** "Review Q3 budget" / "Q3 budget review" → similarity 0.96 (above dedup threshold)
- **Borderline pair:** "Prepare financial summary" / "Revenue dashboard update" → similarity ~0.82 (between auto-link and suggest thresholds)

This gives stable, predictable fixtures that exercise every threshold boundary:
- Auto-link threshold (0.90): within-cluster pairs cross it, cross-cluster pairs don't
- Suggest threshold (0.75): borderline pairs land between suggest and auto-link
- Dedup threshold (0.85): near-duplicate pair is above, related items are below
- Discard: outlier is below all thresholds

**Unit test coverage:**
- Text assemblers: correct concatenation, prefix tags (`[Task]`, `[Meeting]`), null field handling, empty input
- Chunking algorithm: boundary sizes, overlap correctness, paragraph/sentence splitting, empty input, single paragraph
- RRF fusion: score computation, tie-breaking, deduplication across keyword + vector lists
- Auto-link threshold logic: items in same cluster → auto-link, cross-cluster → suggest or discard, outlier → discard
- Duplicate detection: near-duplicate pair flagged, related-but-different items not flagged
- Centroid computation: averaging vectors, empty list edge case, single-item list
- Graceful degradation: no API key → keyword-only, no errors

### Layer 2: Integration Tests (Real DB, Mock Provider)

Tests the full pipeline end-to-end with a real Postgres+pgvector instance (existing Docker test setup) and the `MockEmbeddingProvider`. No external API calls.

**Test coverage:**
- **Embedding pipeline:** create item → embedding stored in `Embedding` table → verify `entityType`, `entityId`, `chunkIndex`, `chunkText` correct
- **Upsert semantics:** update item title → embedding updated (not duplicated) → verify `updatedAt` changed, same row
- **Chunk lifecycle:** create content item with large body → N chunks stored → update with shorter body → orphan chunks deleted
- **Hybrid search:** insert items from different clusters → search with query from cluster A → verify cluster A items rank highest, keyword matches boost via RRF
- **Cross-type search:** insert item + event + finding about same topic → search returns all three with correct `entityType`
- **Auto-linking:** create two items from same cluster → verify `ItemLink` created with `source = "embedding"` → verify bidirectional
- **Auto-link threshold boundary:** create items at 0.89 similarity (mock) → verify NO auto-link, only suggestion
- **Duplicate detection:** create near-duplicate item → verify `duplicateCandidates` in response
- **Deletion cascade:** delete item → verify all embeddings for that entity removed
- **List centroid:** add items to list → request list suggestions for new item → verify correct list suggested
- **Calendar related items:** create event + related tasks → query related items → verify correct items returned above threshold
- **Backfill:** create items without embeddings → run backfill → verify all items now have embeddings
- **Concurrent writes:** parallel embedding upserts don't deadlock or duplicate (pgvector + unique constraint)

### Performance Tests
- Search latency with 1K, 10K, 50K embeddings per user
- Backfill throughput (items/second)
- Concurrent embedding writes under load

---

## Graceful Degradation

If the embedding system is unavailable (API key missing, OpenAI down, pgvector issue):

| Feature | Degraded Behavior |
|---------|-------------------|
| Search | Falls back to keyword-only (existing ILIKE behavior) |
| Related items | Section hidden (no suggestions) |
| Duplicate detection | Skipped (item creates normally) |
| List suggestions | Section hidden |
| Auto-linking | Disabled |
| Calendar related items | Section hidden |
| AI context enrichment | Proceeds without embedding context |

The system should never block or error on embedding failures. Every embedding operation is fire-and-forget with error logging.

---

## Cost Projections

| Scale | Items | Events/mo | Findings/mo | Embed Calls/mo | Cost/mo |
|-------|-------|-----------|-------------|----------------|---------|
| 1 user (light) | 200 | 100 | 50 | ~400 | $0.024 |
| 1 user (heavy) | 2,000 | 500 | 500 | ~3,500 | $0.21 |
| 1,000 users (avg) | 500K total | 200K | 100K | ~900K | $54 |
| 10,000 users (avg) | 5M total | 2M | 1M | ~9M | $540 |

These costs assume ~200 tokens average per embedding call and $0.06/1M tokens (Voyage `voyage-3-large`). Content body chunking adds ~3x for content-heavy users but the absolute cost remains negligible.

---

## Open Questions (Resolved)

1. **Embed everything on day 1?** → Yes. Cost is negligible, and partial embedding creates confusing UX where some items are searchable and others aren't.

2. **Auto-link vs suggest?** → Hybrid. Above 0.90 → auto-link. 0.75-0.90 → suggest. Below 0.75 → discard.

3. **Change inbox grouping?** → No. Keep the 4-bucket temporal grouping.

4. **Pricing model?** → Free tier includes embeddings. Paid tier adds AI features that are enhanced by embeddings.

5. **Embedding provider?** → Voyage AI `voyage-3-large` on a Brett-owned key. Chosen for best-in-class retrieval quality and asymmetric search support (`input_type: "query"` vs `"document"`). 1024 dimensions. The `EmbeddingProvider` interface is provider-agnostic — can swap to another provider by adding a new class and running a re-embed backfill.
