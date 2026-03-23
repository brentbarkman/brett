# Brett AI Platform — Design Spec

**Date:** 2026-03-23
**Status:** Approved (brainstorming complete)
**Scope:** AI foundations, Omnibar, BrettThread, Morning Briefing, Brett's Take, Up Next, memory system, eval harness, MCP integration, BYOK configuration

---

## 1. Overview

Brett's AI platform enables all AI-powered features through a unified server-side architecture. Users bring their own API keys (BYOK) from Anthropic, OpenAI, or Google. The system exposes Brett's full functionality as skills that can be invoked by the LLM, providing a natural language interface via the Omnibar and contextual chat via BrettThread.

### Features powered by this platform

| Feature | Description | Model tier |
|---------|-------------|-----------|
| **Omnibar** | Natural language interface to all of Brett's functionality | Small (classification) → varies (execution) |
| **⌘K Spotlight** | Global hotkey variant of Omnibar, works from any screen | Same as Omnibar |
| **BrettThread** | Persistent, context-aware chat on items and calendar events | Medium |
| **Morning Briefing** | Daily summary of calendar, tasks, and relevant context | Medium |
| **Brett's Take** | AI-generated insight on items and calendar events | Medium |
| **Up Next** | Next calendar event + Brett's take on it | Medium |
| **Scouts** (future) | Autonomous mini-agents that monitor the web | Large |

### Principles

- **Server-proxied inference** — all LLM calls go through the API server, never directly from the client.
- **One skill registry** — Omnibar, BrettThread, Scouts, and background jobs all share the same skill definitions.
- **Graceful degradation** — every feature works or degrades cleanly when no API key is configured.
- **Three-layer memory** — raw logs (always), structured facts (extracted), vector embeddings (semantic recall).
- **Tier-based model routing** — features request `small`/`medium`/`large`, not specific models.

---

## 2. System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        DESKTOP APP                              │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────┐   │
│  │  Omnibar     │  │  ⌘K Spotlight│  │  BrettThread       │   │
│  │  (top bar)   │  │  (modal)     │  │  (detail panels)   │   │
│  └──────┬───────┘  └──────┬───────┘  └────────┬───────────┘   │
│         └────────┬────────┘                    │               │
│         ┌────────▼─────────┐          ┌───────▼────────┐      │
│         │ useOmnibar()     │          │ useBrettChat() │      │
│         └────────┬─────────┘          └───────┬────────┘      │
│         ┌────────▼────────────────────────────▼────────┐      │
│         │           Streaming HTTP Client               │      │
│         │    POST /brett/omnibar  POST /brett/chat      │      │
│         └────────────────────┬─────────────────────────┘      │
└──────────────────────────────┼─────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                          API SERVER                              │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    AI Gateway                            │   │
│  │  Provider Adapters  │  Model Router  │  Conversation Mgr │   │
│  └─────────────────────────────┬───────────────────────────┘   │
│                                │                                │
│  ┌─────────────────────────────▼───────────────────────────┐   │
│  │                   Skill Registry                         │   │
│  │  create_task, search_things, update_task, list_today,   │   │
│  │  get_calendar, create_list, morning_briefing, ...       │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌──────────────────┐  ┌──────────────┐  ┌────────────────┐   │
│  │  Memory System   │  │  MCP Client  │  │  Eval Harness  │   │
│  │  A: Raw logs     │  │  Granola     │  │  Fixtures      │   │
│  │  B: Facts table  │  │              │  │  LLM-as-judge  │   │
│  │  C: pgvector     │  │              │  │                │   │
│  └──────────────────┘  └──────────────┘  └────────────────┘   │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              Background Jobs (future)                    │   │
│  │  Scout Runner  │  Briefing Generator  │  Fact Extractor │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  Postgres + pgvector                                    │   │
│  │  Items, Lists, Events, ConversationSessions,            │   │
│  │  ConversationMessages, UserAIConfig, UserFacts,         │   │
│  │  ConversationEmbeddings                                 │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. New Package: @brett/ai

A new shared package in the monorepo containing all AI logic. Used by the API server and future background job runners.

```
packages/ai/
  src/
    index.ts                    # Public API
    providers/
      types.ts                  # AIProvider interface, StreamChunk, ChatParams
      anthropic.ts              # Anthropic SDK adapter (~80 lines)
      openai.ts                 # OpenAI SDK adapter (~80 lines)
      google.ts                 # Google Generative AI adapter (~80 lines)
      factory.ts                # getProvider(name, apiKey) → AIProvider
    router.ts                   # Model tier → model name resolution
    skills/
      registry.ts               # SkillRegistry class
      types.ts                  # Skill, SkillContext, SkillResult, DisplayHint
      create-task.ts
      create-content.ts
      update-item.ts
      complete-task.ts
      search-things.ts
      get-item-detail.ts
      move-to-list.ts
      snooze-item.ts
      list-today.ts
      list-upcoming.ts
      list-inbox.ts
      get-list-items.ts
      create-list.ts
      archive-list.ts
      get-calendar-events.ts
      get-next-event.ts
      get-meeting-notes.ts      # MCP → Granola
      morning-briefing.ts
      bretts-take.ts
      up-next.ts
      recall-memory.ts          # Vector search
      change-settings.ts
      submit-feedback.ts
      explain-feature.ts
      get-stats.ts
    context/
      assembler.ts              # Context assembly per caller type
      system-prompts.ts         # Brett's personality + per-feature prompts
    memory/
      raw-store.ts              # Layer A: conversation logging
      facts.ts                  # Layer B: structured fact extraction + retrieval
      embeddings.ts             # Layer C: pgvector embed + search
    mcp/
      client.ts                 # MCP client for external sources
      granola.ts                # Granola-specific adapter
  package.json
  tsconfig.json
```

### Dependency graph update

```
@brett/types          ← shared TS interfaces
  ↑
@brett/utils          ← generic helpers
  ↑
@brett/business       ← domain logic
  ↑
@brett/ai             ← AI providers, skills, memory, MCP (NEW)
  ↑
@brett/api            ← Hono routes (imports ai package)
```

`@brett/ai` imports `@brett/business` (for validators like `validateCreateItem`), `@brett/types`, and `@brett/utils`. The `@brett/ui` package does NOT import `@brett/ai` — the desktop app talks to AI exclusively through API endpoints.

---

## 4. Provider Adapter Layer

### Interface

```typescript
interface AIProvider {
  chat(params: ChatParams): AsyncIterable<StreamChunk>
}

// Embedding is a separate concern — see "Embedding Strategy" below
interface EmbeddingProvider {
  embed(text: string): Promise<number[]>
  dimensions: number
}

interface ChatParams {
  model: string
  messages: Message[]
  tools?: ToolDefinition[]
  temperature?: number
  maxTokens?: number
  system?: string
}

type StreamChunk =
  | { type: "text"; content: string }
  | { type: "tool_call"; id: string; name: string; args: Record<string, unknown> }
  | { type: "tool_result"; id: string; content: string }
  | { type: "done"; usage: { input: number; output: number } }
```

### Provider implementations

Each provider is ~80 lines mapping to their SDK:
- **Anthropic** (`@anthropic-ai/sdk`): `system` is top-level param, tool results use `tool_result` role
- **OpenAI** (`openai`): tool calls wrapped in `function` objects, tool results use `tool` role
- **Google** (`@google/generative-ai`): slightly different tool result format, `functionCall`/`functionResponse`

### Factory

```typescript
function getProvider(name: "anthropic" | "openai" | "google", apiKey: string): AIProvider
```

### Embedding strategy

Embeddings are decoupled from the chat provider because:
- Anthropic does not offer an embedding API
- Switching chat providers would create incompatible vectors in the same column
- Embedding dimension must be consistent across all stored vectors

**Approach:** Always use OpenAI's `text-embedding-3-small` (1536 dimensions) for embeddings, regardless of which chat provider is active. This requires either:
- The user has an OpenAI key stored (even if not active for chat), OR
- The user only has Anthropic/Google — Layer C (vector memory) is skipped, Layers A and B still work. When they later add an OpenAI key, we backfill embeddings from stored raw logs (Layer A).

The `EmbeddingProvider` is instantiated separately from the chat `AIProvider`:

```typescript
function getEmbeddingProvider(userId: string): EmbeddingProvider | null
// Returns OpenAI embedding provider if user has an OpenAI key, null otherwise
```

This is a pragmatic tradeoff: OpenAI's embedding API is cheap ($0.02/1M tokens), widely available, and produces high-quality vectors. Using a single embedding model ensures all vectors are comparable.

---

## 5. Model Router

Features request a tier, not a specific model. The router resolves based on the user's configured provider.

```typescript
type ModelTier = "small" | "medium" | "large"

const MODEL_MAP = {
  anthropic: {
    small:  "claude-haiku-4-5-20251001",
    medium: "claude-sonnet-4-6",
    large:  "claude-opus-4-6",
  },
  openai: {
    small:  "gpt-4o-mini",
    medium: "gpt-4o",
    large:  "o3",
  },
  google: {
    small:  "gemini-2.0-flash-lite",
    medium: "gemini-2.0-flash",
    large:  "gemini-2.5-pro",
  },
}

function resolveModel(provider: ProviderName, tier: ModelTier): string
```

### Tier assignment by feature

| Feature | Tier | Rationale |
|---------|------|-----------|
| Omnibar intent classification | small | Speed-critical, simple task |
| Task creation / parsing | small | Structured output, low complexity |
| Brett's Take | medium | Needs reasoning + context synthesis |
| Morning Briefing | medium | Aggregation + synthesis |
| BrettThread chat | medium | Conversational, nuanced |
| Scouts | large | Deep reasoning, long context, web analysis |
| Complex omnibar (multi-step) | medium–large | Tool use + reasoning chains |

---

## 6. Skill System

### Skill interface

```typescript
interface Skill {
  name: string                      // "create_task"
  description: string               // LLM-optimized description
  parameters: JSONSchema            // For LLM tool_use + validation
  modelTier: ModelTier              // Minimum tier needed
  requiresAI: boolean              // false = works in command palette mode

  execute(params: unknown, ctx: SkillContext): Promise<SkillResult>
}

interface SkillContext {
  userId: string
  prisma: PrismaClient
  provider?: AIProvider             // For skills needing sub-calls
  mcpClient?: MCPClient
}

interface SkillResult {
  success: boolean
  data?: unknown                    // Structured result for LLM
  displayHint?: DisplayHint         // How UI should render this
  message?: string                  // Human-readable summary
}

type DisplayHint =
  | { type: "task_created"; taskId: string }
  | { type: "task_list"; items: ThingSummary[] }
  | { type: "calendar_events"; events: CalendarEventSummary[] }
  | { type: "confirmation"; message: string; action: string }
  | { type: "settings_changed"; setting: string }
  | { type: "text" }
```

### Skill registry

```typescript
class SkillRegistry {
  register(skill: Skill): void
  get(name: string): Skill | undefined
  toToolDefinitions(): ToolDefinition[]     // For LLM tool_use
  getNoKeySkills(): Skill[]                 // requiresAI === false
}
```

Static registry initialized at server startup. All skills hand-authored with curated descriptions optimized for LLM accuracy.

### Launch skills (25 total)

**Items & Tasks:** `create_task`, `create_content`, `update_item`, `complete_task`, `search_things`, `get_item_detail`, `move_to_list`, `snooze_item`

**Lists & Organization:** `list_today`, `list_upcoming`, `list_inbox`, `get_list_items`, `create_list`, `archive_list`

**Calendar:** `get_calendar_events`, `get_next_event`, `get_meeting_notes` (MCP → Granola)

**Brett Intelligence:** `morning_briefing`, `bretts_take`, `up_next`, `recall_memory` (vector search)

**Meta / System:** `change_settings`, `submit_feedback`, `explain_feature`, `get_stats`

**Future (Scouts):** `web_search`, `web_scrape`, `create_scout`, `list_scouts`, `scout_report`

**Future (Calendar write):** `rsvp_event` — requires upgrading Google OAuth scopes from `calendar.readonly` to `calendar.events`, which means existing users must re-authorize. Deferred to avoid scope migration complexity at launch.

### Skill execution flow

1. User input arrives (Omnibar or BrettThread)
2. Context assembler builds the full context (system prompt, user facts, page context, history)
3. LLM receives message + skills as tool definitions
4. LLM returns tool_call with skill name + args
5. Server looks up skill in registry, executes it
6. Result streamed back to client with displayHint
7. UI renders rich result card based on hint type
8. LLM may chain multiple tool calls before final text response

---

## 7. Data Model

### New tables

#### UserAIConfig (BYOK key storage)

```prisma
model UserAIConfig {
  id            String   @id @default(cuid())
  userId        String
  user          User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  provider      String   // "anthropic" | "openai" | "google"
  encryptedKey  String   @db.Text
  isValid       Boolean  @default(true)
  isActive      Boolean  @default(false)   // only one active at a time
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  @@unique([userId, provider])   // one key per provider per user
  @@index([userId])
}
```

Supports multiple stored keys (one per provider), with one active at a time. Encryption: AES-256-GCM using the existing `CALENDAR_TOKEN_ENCRYPTION_KEY` env var (renamed to `TOKEN_ENCRYPTION_KEY` for generality). The existing `token-encryption.ts` utility is renamed to `encryption.ts` and shared between calendar OAuth tokens and AI API keys.

#### ConversationSession (raw log — Layer A)

```prisma
model ConversationSession {
  id              String    @id @default(cuid())
  userId          String
  user            User      @relation(...)
  source          String    // "omnibar" | "brett_thread" | "briefing" | "scout"
  itemId          String?
  item            Item?     @relation(...)
  calendarEventId String?
  calendarEvent   CalendarEvent? @relation(...)
  modelTier       String
  modelUsed       String
  createdAt       DateTime  @default(now())
  messages        ConversationMessage[]

  @@index([userId, createdAt])
  @@index([itemId])
  @@index([calendarEventId])
}
```

#### ConversationMessage

```prisma
model ConversationMessage {
  id          String    @id @default(cuid())
  sessionId   String
  session     ConversationSession @relation(...)
  role        String    // "user" | "assistant" | "tool_call" | "tool_result"
  content     String    @db.Text
  toolName    String?
  toolArgs    Json?
  tokenCount  Int?
  createdAt   DateTime  @default(now())

  @@index([sessionId, createdAt])
}
```

**Message role mapping:** The four roles map storage representation, not LLM wire format. When reconstructing conversation history for a provider:
- `"user"` → provider's user message format
- `"assistant"` → provider's assistant message (text content)
- `"tool_call"` → nested into the preceding assistant message as a tool use block (Anthropic: `tool_use` content block, OpenAI: `tool_calls` array on the assistant message, Google: `functionCall` part)
- `"tool_result"` → provider's tool result format (Anthropic: `tool_result` role, OpenAI: `tool` role, Google: `functionResponse` part)

The `context/assembler.ts` module handles this reconstruction per provider. Storing tool calls as separate rows makes them independently queryable and avoids deeply nested JSON in the content column.

```prisma
// (continued)
```

#### UserFact (structured facts — Layer B)

```prisma
model UserFact {
  id              String    @id @default(cuid())
  userId          String
  user            User      @relation(...)
  category        String    // "preference" | "context" | "relationship" | "habit"
  key             String    // "prefers_morning_meetings", "tracks_nvda"
  value           String    @db.Text
  confidence      Float     @default(1.0)
  sourceSessionId String?
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  @@unique([userId, key])
  @@index([userId, category])
}
```

#### ConversationEmbedding (vector memory — Layer C)

```prisma
model ConversationEmbedding {
  id          String    @id @default(cuid())
  userId      String
  user        User      @relation(...)
  sessionId   String
  session     ConversationSession @relation(...)
  chunkText   String    @db.Text
  embedding   Unsupported("vector(1536)")
  createdAt   DateTime  @default(now())

  @@index([userId])
  // + HNSW index on embedding via raw SQL migration
}
```

Requires `pgvector` extension enabled on Postgres. Railway supports this.

### Migration from BrettMessage

Existing `BrettMessage` rows migrate into `ConversationSession` + `ConversationMessage`:
- **Grouping:** One `ConversationSession` per unique `itemId` or `calendarEventId`. Messages on the same item become one session.
- **Session fields:** `source: "brett_thread"`, `modelTier: "none"`, `modelUsed: "stub"` (these are pre-AI messages).
- **Message mapping:** `role: "user"` stays `"user"`, `role: "brett"` becomes `"assistant"`.
- **Execution:** One-time data migration script (not a Prisma migration) run after the schema migration creates the new tables. The `BrettMessage` table is dropped in a subsequent migration after verification.

BrettThread component reads from the new tables — same UX, richer data model.

---

## 8. Memory System

Three layers, each serving a different purpose:

### Layer A: Raw conversation logs

- **What:** Every conversation turn stored in `ConversationSession` + `ConversationMessage`
- **When:** Synchronous, during request processing
- **Cost:** Negligible (text in Postgres)
- **Purpose:** Audit trail, reprocessing foundation for B and C

### Layer B: Structured facts

- **What:** Key-value facts extracted from conversations, stored in `UserFact`
- **When:** Async, after response is sent to user
- **How:** Small model scans the conversation: "Did the user reveal a preference, habit, or context worth remembering?" Upserts into `UserFact`
- **Reading:** Always loaded into system prompt for every AI interaction
- **User control:** Viewable and deletable in Settings → Brett's Memory

### Layer C: Vector embeddings

- **What:** Conversation text embedded and stored in `ConversationEmbedding` via pgvector
- **When:** Async, after response is sent
- **How:** `EmbeddingProvider.embed()` generates vectors (always OpenAI text-embedding-3-small), stored with HNSW index. Skipped if no OpenAI key available — backfilled when one is added.
- **Reading:** Queried via cosine similarity when context needs historical recall (BrettThread, "remember when...", Scout relevance)
- **Cost:** ~$0.0001 per turn via embedding models

### Timing

```
User sends message
    │
    ▼ (synchronous)
Layer A: Store raw messages
    │
    ▼ (synchronous)
AI processes request, streams response
    │
    ▼ (async, after response sent)
Layer B: Extract structured facts
Layer C: Embed for vector recall
```

The user never waits for fact extraction or embedding.

---

## 9. Conversation Manager & Context Assembly

Different callers get different context windows, all assembled by the conversation manager.

### Omnibar context
- System prompt (Brett's personality + skill descriptions)
- User's structured facts (Layer B)
- Current page context (view, selected item — sent by client)
- This session's message history (ephemeral)
- Available skills as tool definitions

### BrettThread context
- System prompt (Brett's personality + skill descriptions)
- User's structured facts (Layer B)
- Full item data (title, notes, attachments, links)
- Persistent message history on this item
- Vector recall of related past conversations (Layer C)
- MCP context if relevant (Granola notes for calendar events)

### Morning Briefing context
- Briefing-specific system prompt
- User's structured facts
- Today's calendar events
- Overdue + due-today tasks
- Granola notes for today's meetings (via MCP)
- Recent activity summary

### Scout context (future)
- Scout-specific system prompt + objective
- Scout configuration (goal, criteria, cadence)
- User's structured facts
- Previous run results
- Web search/scrape tools + Brett skills

---

## 10. Omnibar UX

### Hybrid: Persistent top bar + ⌘K spotlight

Two surfaces sharing one brain via `useOmnibar()` hook. Both render the same content. Only one active at a time — opening one closes the other.

### States

1. **Collapsed (resting):** Pill-shaped bar at top of content area. Shows "Ask Brett anything..." placeholder and ⌘K hint. Click or focus to expand.

2. **Active, no AI key:** Command palette mode. Shows actionable suggestions as user types:
   - "Create task: {input}" (highlighted, Enter to execute)
   - "Search: {input}"
   - Fuzzy matching on command names and item titles

3. **Active, with AI key:** Same as above but "Ask Brett" appears as top suggestion. Command palette options below. Enter sends to top suggestion (Ask Brett).

4. **Responding (streaming):** Full conversation mode. Streaming response with rich display hint cards (task created, calendar events, confirmation, etc.). Follow-up input ready at bottom. Panel grows to fit content, bounded at 60vh.

### ⌘K Spotlight variant

Centered modal with backdrop blur. Same content as top bar, floating over dimmed background. Works from any screen (Settings, Calendar, etc.).

### Interaction rules

- **⌘K** — opens spotlight from any screen. If top bar is expanded, closes it first.
- **Escape** — closes whichever surface is open. If streaming, cancels the request.
- **Enter** — sends to top suggestion (Ask Brett if AI enabled, Create Task if not).
- **↑/↓ arrows** — navigate suggestions in command palette mode.
- **Click outside** — closes expanded panel / spotlight.
- **Session reset** — closing the omnibar clears the session. Reopening starts fresh.
- **Fast path** — input starting with `/` skips LLM, goes straight to command palette matching.
- **Max height** — expanded panel bounded to 60vh, scrolls internally.
- **Streaming cancel** — user can type while Brett is responding; sending interrupts the stream.

### No-key degradation

Without an API key, "Ask Brett" does not appear. The command palette (create task, search, slash commands) is fully functional. No broken state.

### Frontend hooks

New hooks in `apps/desktop/src/api/`:

| Hook | Location | Replaces | Purpose |
|------|----------|----------|---------|
| `useOmnibar()` | `apps/desktop/src/api/omnibar.ts` | — (new) | Omnibar + ⌘K state, streaming, session management |
| `useBrettChat()` | `apps/desktop/src/api/brett-chat.ts` | `useBrettMessages()` + `useSendBrettMessage()` in `brett.ts` | Item/event-scoped chat with streaming |
| `useBriefing()` | `apps/desktop/src/api/briefing.ts` | — (new) | Morning briefing fetch/generate |
| `useBrettsTake()` | `apps/desktop/src/api/bretts-take.ts` | — (new) | Brett's Take on items/events |
| `useAIConfig()` | `apps/desktop/src/api/ai-config.ts` | — (new) | BYOK key management CRUD |
| `useUserFacts()` | `apps/desktop/src/api/user-facts.ts` | — (new) | Memory facts list/delete |
| `useStreamingFetch()` | `apps/desktop/src/api/streaming.ts` | — (new) | Low-level POST+SSE streaming parser |

The existing `apps/desktop/src/api/brett.ts` hooks (`useBrettMessages`, `useSendBrettMessage`, `useBrettTake`) are replaced by `useBrettChat` and `useBrettsTake`. The old file is deleted after migration.

---

## 11. API Endpoints

### New route modules

#### AI Config (`routes/ai-config.ts`)

```
GET    /ai/config              → List user's configured providers (keys redacted)
POST   /ai/config              → Add/update a provider key (validates before saving)
PUT    /ai/config/:id/activate → Set a provider as active
DELETE /ai/config/:id          → Remove a stored key
```

#### Omnibar (`routes/brett-omnibar.ts`)

```
POST   /brett/omnibar          → Send message, stream response (SSE)
  body: {
    message: string,
    sessionId?: string,
    context?: { currentView: string, selectedItemId?: string }
  }
  response: text/event-stream
```

#### BrettThread Chat (`routes/brett-chat.ts`)

Replaces current `routes/brett.ts`.

```
POST   /brett/chat/:itemId          → Send message on item, stream response
POST   /brett/chat/event/:eventId   → Send message on calendar event, stream response
GET    /brett/chat/:itemId          → Paginated history
GET    /brett/chat/event/:eventId   → Paginated event chat history
```

#### Intelligence (`routes/brett-intelligence.ts`)

```
GET    /brett/briefing              → Get today's morning briefing (cached)
POST   /brett/briefing/generate     → Force-regenerate briefing (streaming)
POST   /brett/take/:itemId          → Generate Brett's Take on item
POST   /brett/take/event/:eventId   → Brett's Take on calendar event
GET    /brett/up-next               → Next event + Brett's take
```

#### Memory (`routes/brett-memory.ts`)

```
GET    /brett/memory/facts          → User's structured facts
DELETE /brett/memory/facts/:id      → Delete a fact
```

### Streaming implementation note

The existing SSE system (`/events` endpoint) is a push model — server broadcasts events to connected clients via `EventSource`. The AI streaming endpoints are a different pattern: **POST-with-SSE-response** — client POSTs a message, server streams the response back on that same HTTP connection.

**Server side:** Hono's `c.stream()` or `streamSSE()` helper writes chunks to the response. The connection is opened by the POST request and closed when the `done` chunk is sent (or on error/cancel).

**Client side:** New streaming fetch utility in `apps/desktop/src/api/streaming.ts` that parses SSE from a `fetch()` response body (not `EventSource`, which only supports GET). This is new infrastructure — the existing `useEventStream` hook is for the push SSE channel and is not reused here.

### Streaming protocol

SSE with typed chunks, same format for all streaming endpoints:

```
event: chunk → { type: "text", content: "..." }
event: chunk → { type: "tool_call", id: "...", name: "...", args: {...} }
event: chunk → { type: "tool_result", id: "...", data: {...}, displayHint: {...} }
event: chunk → { type: "done", sessionId: "...", usage: {...} }
event: error → { message: "..." }
```

### AI middleware guard

Applied to all `/brett/*` routes that need AI. Loads active `UserAIConfig`, decrypts key, instantiates provider, sets on Hono context. Returns `403 ai_not_configured` when no key exists.

Exempted routes (no AI needed): `GET /ai/config`, `GET /brett/chat/*` (reading history), `GET /brett/memory/facts`.

### Route migration

| Current | New | Change |
|---------|-----|--------|
| `POST /things/:id/brett` | `POST /brett/chat/:itemId` | Streams, uses real AI |
| `GET /things/:id/brett` | `GET /brett/chat/:itemId` | Reads from ConversationSession |
| `POST /things/:id/brett-take` | `POST /brett/take/:itemId` | Streams, uses real AI |
| — | `POST /brett/omnibar` | New |

---

## 12. Settings UI

### New "AI" section in Settings

Positioned after Calendar section, before Sign Out.

**AI Provider subsection:**
- Provider toggle: Anthropic / OpenAI / Google (pill-style selector)
- API key input (password field) with Save button
- Validation on save: lightweight API call (list models) to verify key works
- Connection status indicator (green dot + "Connected — Provider (Model)")
- Support for multiple stored keys, one active at a time

**Brett's Memory subsection:**
- List of extracted facts with category labels
- Delete button per fact (user control over their profile)
- Facts shown as readable text: "Prefers morning meetings", "Tracks NVDA stock actively"

---

## 13. MCP Integration

### Granola (launch)

- Server-side MCP client in `@brett/ai`
- Configured via `GRANOLA_MCP_URL` env var
- Exposed as `get_meeting_notes` skill
- Also used by context assembler for briefings and Brett's Take on calendar events

### Data flow

```
Calendar event → Context assembler queries MCP →
  "notes for meeting on DATE with ATTENDEES" →
  Granola returns notes → Injected into prompt →
  Brett produces informed briefing/take
```

### Future

Settings UI gets an "Integrations" section where users can connect MCP sources. For launch, Granola is server-configured only.

---

## 14. Eval System

### Structure

```
evals/
  fixtures/
    intent-classification.json    # input → expected skill
    parameter-extraction.json     # input → expected params
    bretts-take-quality.json      # context → criteria
    briefing-quality.json         # day data → criteria
    fact-extraction.json          # conversation → expected facts
  runner.ts                       # Runs fixtures through real LLM
  judge.ts                        # LLM-as-judge for qualitative evals
  scores/                         # Historical results (gitignored)
  README.md
```

### Eval types

**Deterministic evals** (intent classification, parameter extraction):
- JSON fixtures with `input` → `expectedSkill` / `expectedParams`
- Run through actual LLM, assert on skill selection and parameter accuracy
- Pass/fail per fixture, aggregate accuracy score

**Qualitative evals** (Brett's Take, briefings, fact extraction):
- Fixtures define context + criteria (e.g., "mentions the meeting topic", "does NOT hallucinate")
- LLM-as-judge: separate small model grades output against each criterion
- Passing score threshold per fixture (e.g., 4/5 criteria met)

### Running

```bash
pnpm eval --provider anthropic          # Run all fixtures
pnpm eval --provider openai --suite intent-classification   # Specific suite
pnpm eval:compare <run1> <run2>         # Compare scores across runs
```

Not in CI — costs money, hits real APIs. Run manually before shipping prompt or skill changes.

---

## 15. Latency Considerations

| Path | Concern | Mitigation |
|------|---------|-----------|
| Omnibar classification | 500ms-1.5s to first token | Small model (200-400ms TTFT), optimistic UI (typing indicator), fast-path for `/` commands |
| BrettThread | Low — users expect conversational latency | Streaming |
| Morning Briefing | None if pre-generated | Generate on first app open of the day, cache |
| Brett's Take on events | Moderate if not pre-generated | Pre-generate for events in next 24 hours when calendar syncs |
| Vector recall (pgvector) | Negligible | ~5-20ms for cosine similarity |
| MCP/Granola latency | Could block context assembly | 500ms timeout, proceed without if slow |

---

## 16. Security & Rate Limiting

- **API key encryption:** AES-256-GCM at rest using existing `TOKEN_ENCRYPTION_KEY` (renamed from `CALENDAR_TOKEN_ENCRYPTION_KEY`), decrypted only in memory during LLM calls, never logged
- **Key validation:** Lightweight API call on save to verify key works
- **No keys in URLs:** Keys only transit in POST request bodies over HTTPS
- **User data in prompts:** User's data is sent to the LLM provider the user chose — this is inherent to BYOK. Users are made aware during key setup.
- **AI middleware:** Centralized guard ensures all AI routes check for valid configuration
- **Runtime key failures:** When an LLM call fails with an auth error (401/403), set `UserAIConfig.isValid = false` and return a specific error to the client so the Settings UI can show a "key invalid" state. User must re-enter or re-validate the key.
- **Rate limiting:** Per-user throttle on AI endpoints to prevent runaway costs from bugs or reconnection loops. Default: 30 requests/minute to streaming endpoints, 100 requests/minute to non-streaming. Implemented via simple in-memory counter (or Redis if available). Returns `429 Too Many Requests` with `Retry-After` header.
- **Env var rename:** `CALENDAR_TOKEN_ENCRYPTION_KEY` → `TOKEN_ENCRYPTION_KEY`. Old name supported as fallback during transition.

---

## 17. Future: Scouts (architecture only)

Scouts are autonomous mini-agents that run server-side on a schedule. The AI platform is designed to support them without rearchitecting:

- **Scout table:** config, cadence, last run, status, user relation
- **Execution:** Server-side scheduled jobs using the same `@brett/ai` package
- **Tool belt:** Same skill registry as Omnibar + web search/scrape tools
- **Judgment:** LLM decides if findings are "interesting enough" to surface
- **Output:** Creates feed items visible to the user
- **Chaining:** One Scout's output can feed into another Scout's context
- **Model tier:** Large (deep reasoning, long context needed for web analysis)

No Scout implementation in this spec — just confirming the platform supports it.
