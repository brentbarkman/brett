# Brett's Memory System

## The Big Picture

Brett remembers things about you the same way a great executive assistant would — by paying attention to your conversations, meetings, and tasks, then building up a mental model of your world over time.

Every time you interact with Brett, four things happen behind the scenes:

```
You chat with Brett
        |
        v
  +-----------+     +-----------+     +-----------+
  |  Extract   |     |  Extract   |     |   Embed    |
  |   Facts    |     |   Graph    |     |   Content  |
  +-----------+     +-----------+     +-----------+
        |                 |                 |
        v                 v                 v
  +-----------+     +-----------+     +-----------+
  | User Facts |     | Knowledge  |     | Embeddings |
  | Database   |     |   Graph    |     |  (Vectors) |
  +-----------+     +-----------+     +-----------+
        \                 |                /
         \                |               /
          v               v              v
        +-----------------------------+
        |     Unified Retrieval        |
        |  (combines all 4 layers)     |
        +-----------------------------+
                      |
                      v
            Brett's next response
            is informed by everything
            it knows about you
```

---

## The Four Layers

### Layer 1: Search (Embeddings + Full-Text)

**What it does:** Finds relevant content from your past conversations, tasks, calendar events, and meeting notes.

**How it works:**

Think of it like two different search engines working together:

- **Full-text search** is like Google — it matches words directly. If you said "budget" last week, searching "budget" finds it. It's fast and precise, and it understands word variations (searching "running" finds "run").

- **Vector search** is like "vibe matching" — it understands meaning, not just words. If you discussed "quarterly financial planning," vector search would surface it when you ask about "budget," even though the word "budget" never appeared.

```
Your question: "What did we discuss about the budget?"
                    |
         +----------+----------+
         |                     |
    Full-Text Search      Vector Search
    (exact words)         (meaning/vibe)
         |                     |
         +----------+----------+
                    |
              Fuse Results
              (combine & rank)
                    |
              Rerank (Voyage AI)
              (re-score by relevance)
                    |
              Top results returned
```

After combining results from both searches, a **reranker** (Voyage AI) takes a second pass to put the most relevant results first. Think of it as a copy editor reviewing the search results before Brett sees them.

---

### Layer 2: Facts (Structured Memory)

**What it does:** Remembers specific things about you — your preferences, habits, role, relationships.

**How it works:**

After every conversation, Brett extracts **facts** — structured pieces of knowledge like:

| Category | Key | Value |
|----------|-----|-------|
| preference | communication_style | Prefers Slack over email |
| context | job_role | VP Product at Acme Corp |
| habit | review_schedule | Reviews PRs every morning |
| relationship | manager | Reports to Sarah Kim |

These aren't just dumped in a pile. Brett tracks **when** each fact was learned and handles **contradictions**:

```
Day 1: "I use VS Code"
  -> Stores: preferred_editor = "VS Code"

Day 30: "I switched to Cursor"
  -> Finds existing "preferred_editor" fact
  -> Marks old fact as expired (validUntil = now)
  -> Creates new fact: preferred_editor = "Cursor"
  -> Links them: old fact supersededBy new fact
```

This means Brett always knows the **current** truth, but can also look back at what changed and when. No more "but you told me last month you use VS Code" confusion.

Facts are assembled into a **user profile** that's included in every conversation, so Brett always has your context without you repeating yourself.

---

### Layer 3: Knowledge Graph

**What it does:** Maps the people, companies, projects, and tools in your world and how they connect.

**How it works:**

Every conversation and meeting note gets scanned for **entities** (people, companies, projects, tools, locations) and **relationships** between them.

```
"I had a meeting with Jordan Chen from Acme Corp
 about the Q3 roadmap. We're using Figma for the designs."

                    Extracts:
                       |
                       v

    [Jordan Chen] --works_at--> [Acme Corp]
         |                           |
    discussed_in               part_of
         |                           |
         v                           v
    [Q3 Roadmap] ---uses---> [Figma]
```

Over time, this builds a rich map of your professional world:

```
                    [You]
                   /  |  \
                  /   |   \
    [Acme Corp]  [Project X]  [Design System]
      /    \         |              |
     /      \        |              |
[Jordan]  [Sarah]  [Sprint 4]   [Figma]
   |         |
   |     manages
   |         |
   v         v
[Q3 Plan]  [Eng Team]
```

When Brett answers a question about Jordan, it doesn't just search for the word "Jordan" — it traverses the graph to find that Jordan works at Acme Corp, is connected to the Q3 roadmap, and was discussed in three of your meetings. This **connected context** makes Brett's answers much richer.

The graph uses **recursive queries** that can follow connections up to 2 hops deep, so asking about Jordan also surfaces Acme Corp and the Q3 roadmap without you mentioning them.

---

### Layer 4: Unified Retrieval (The Router)

**What it does:** Combines all three layers into a single answer when Brett needs context.

**How it works:**

When Brett needs to remember something, it doesn't pick one layer — it runs them all in parallel:

```
"What do you know about the Q3 roadmap?"
                    |
        +-----------+-----------+
        |                       |
   Hybrid Search           Graph Search
   (Layer 1)               (Layer 3)
   - keyword match         - find "Q3 roadmap" entity
   - vector similarity     - traverse connections
   - rerank results        - build context string
        |                       |
        +-----------+-----------+
                    |
              Merge & Format
                    |
                    v
    Search results:
    1. Meeting note from March 15 discussing Q3 goals
    2. Task "Review Q3 roadmap draft" from last week
    3. Calendar event "Q3 Planning with Jordan"

    Graph context:
    Q3 Roadmap [project] --part_of--> Acme Corp [company]
    Q3 Roadmap [project] --discussed_in--> Jordan Chen [person]
    Jordan Chen [person] --works_at--> Acme Corp [company]
```

User facts (Layer 2) are loaded separately into every conversation as part of Brett's system prompt — they're always present, not just when you ask a question.

---

## How Data Flows In

Every interaction feeds the memory system automatically. You never have to tell Brett to "remember" something.

```
+------------------+     +------------------+     +------------------+
|   Conversations  |     |  Meeting Notes   |     |   Tasks/Items    |
|  (Omnibar, Chat) |     |  (Granola sync)  |     |  (Things import) |
+--------+---------+     +--------+---------+     +--------+---------+
         |                         |                        |
         v                         v                        v
+------------------------------------------------------------------+
|                    Embedding Pipeline                              |
|                                                                    |
|  1. Assemble text (title + notes + metadata)                      |
|  2. Chunk into ~500 token pieces                                  |
|  3. Generate 1024-dim vectors via Voyage AI                       |
|  4. Store in Postgres (pgvector)                                  |
|                                                                    |
|  Then, fire-and-forget:                                           |
|  5. Extract facts (if conversation/meeting)                       |
|  6. Extract graph entities & relationships                        |
+------------------------------------------------------------------+
```

### Sources that feed the system:

| Source | Trigger | What happens |
|--------|---------|-------------|
| **Chat with Brett** | Every message | Embed conversation, extract facts + graph |
| **Granola connect** | First connection | Backfill last 30 days of meetings |
| **Meeting ends** | 5 min after event | Sync notes, embed, extract graph |
| **Meeting sweep** | Every 30 min (work hours) | Catch any missed meeting notes |
| **Things 3 import** | Manual import | Embed all imported tasks |
| **Task changes** | Create/edit a task | Re-embed the task |

---

## Maintenance: Memory Consolidation

Like a human brain during sleep, Brett periodically cleans up and consolidates its memory. A background job runs every 24 hours:

```
Consolidation Job (every 24h)
         |
         +-- 1. Confidence Decay
         |      Facts untouched for 30+ days lose
         |      a little confidence (-0.05)
         |      "Maybe this isn't true anymore?"
         |
         +-- 2. Fact Expiry
         |      Very old facts (90+ days) with low
         |      confidence get expired
         |      "This is probably outdated"
         |
         +-- 3. Entity Dedup
                Merge duplicate graph entities
                (e.g., "jordan chen" and "Jordan Chen")
                into one canonical node
```

This prevents the memory from growing stale. A fact you mentioned once 6 months ago gradually fades, while facts you reinforce regularly stay strong.

---

## Security

Every layer enforces **tenant isolation** — your data is never visible to other users:

- Every database query includes `WHERE userId = ?`
- The knowledge graph's recursive traversal checks `userId` on **every join**, not just the starting point
- All LLM extraction prompts include a security block that prevents prompt injection via user content
- Entity names and fact values are validated against injection patterns before storage
- Graph context is wrapped in `<user_data>` tags so the LLM treats it as data, not instructions

---

## Monitoring

The admin dashboard at `/memory` shows proof-of-life for the entire system:

- **Knowledge Graph**: entity/relationship counts, growth rate, breakdown by type
- **Embedding Coverage**: percentage of items, events, and meeting notes with embeddings
- **User Facts**: active vs expired facts, new facts trending
- **Extraction Pipeline**: API call counts and cost tracking
- **Per-User Breakdown**: who has the most graph data
