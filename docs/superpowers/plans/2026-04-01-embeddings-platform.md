# Embeddings Platform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a universal embedding system that makes Brett feel intelligent at every surface — semantic search, auto-linking, duplicate detection, meeting prep — all working without an AI key on the free tier.

**Architecture:** Universal `Embedding` table with polymorphic `(entityType, entityId)` references, Voyage AI `voyage-3-large` (1024 dims) with asymmetric search support, async embedding pipeline with in-process queue, hybrid search (keyword + vector + reciprocal rank fusion). Brett absorbs embedding cost via server-owned API key.

**Tech Stack:** Voyage AI SDK, pgvector (HNSW index), Prisma (raw SQL for vector ops), Vitest (mock provider with semantic clusters)

**Spec:** `docs/superpowers/specs/2026-04-01-embeddings-platform-design.md`

---

## File Map

### New Files

| File | Responsibility |
|------|---------------|
| `packages/ai/src/providers/voyage.ts` | VoyageEmbeddingProvider — implements EmbeddingProvider with inputType support |
| `packages/ai/src/providers/mock-embedding.ts` | MockEmbeddingProvider — deterministic vectors with semantic clusters for testing |
| `packages/ai/src/embedding/assembler.ts` | Text assemblers — builds embeddable text from each entity type |
| `packages/ai/src/embedding/chunker.ts` | Chunking algorithm — splits large text into overlapping chunks |
| `packages/ai/src/embedding/queue.ts` | Async embedding queue — debounced, batched, retry with backoff |
| `packages/ai/src/embedding/pipeline.ts` | Embedding pipeline — orchestrates assemble → chunk → embed → store → post-hooks |
| `packages/ai/src/embedding/search.ts` | Hybrid search — keyword + vector + RRF fusion |
| `packages/ai/src/embedding/similarity.ts` | Similarity queries — related items, auto-linking, dedup, list centroids |
| `apps/api/src/routes/search.ts` | GET /api/search — hybrid search endpoint |
| `apps/api/src/routes/suggestions.ts` | GET /api/things/:id/suggestions, GET /api/things/:id/list-suggestions, GET /api/events/:id/related-items, GET /api/events/:id/meeting-history |
| `apps/api/src/lib/embedding-provider.ts` | Server-side singleton — instantiates VoyageEmbeddingProvider from EMBEDDING_API_KEY |
| `apps/api/src/__tests__/embedding-pipeline.test.ts` | Integration tests for the embedding pipeline |
| `apps/api/src/__tests__/hybrid-search.test.ts` | Integration tests for hybrid search |
| `apps/api/src/__tests__/auto-linking.test.ts` | Integration tests for auto-link and suggestions |
| `packages/ai/src/__tests__/assembler.test.ts` | Unit tests for text assemblers |
| `packages/ai/src/__tests__/chunker.test.ts` | Unit tests for chunking algorithm |
| `packages/ai/src/__tests__/search.test.ts` | Unit tests for RRF fusion |
| `packages/ai/src/__tests__/mock-embedding.test.ts` | Unit tests verifying mock provider semantic clusters |
| `packages/ai/src/__tests__/similarity.test.ts` | Unit tests for threshold logic |

### Modified Files

| File | Change |
|------|--------|
| `apps/api/prisma/schema.prisma` | Add `Embedding` model, add `source` to `ItemLink`, drop `ConversationEmbedding` |
| `packages/ai/src/providers/types.ts` | Add `inputType` param to `EmbeddingProvider.embed()` |
| `packages/ai/src/config.ts` | Add embedding config block |
| `packages/ai/src/index.ts` | Export new embedding modules |
| `packages/ai/src/memory/embeddings.ts` | Rewrite to use universal `Embedding` table |
| `packages/ai/src/skills/recall-memory.ts` | Wire to real search (no longer placeholder) |
| `apps/api/src/routes/things.ts` | Add embedding triggers on create/update, add `duplicateCandidates` to POST response |
| `apps/api/src/routes/links.ts` | Handle `source` field on link creation |
| `apps/api/src/routes/calendar.ts` | Add embedding trigger on event sync |
| `apps/api/src/routes/scouts.ts` | Add embedding trigger on finding creation |
| `apps/api/src/lib/content-extractor.ts` | Add embedding trigger after extraction completes |
| `apps/api/src/lib/scout-runner.ts` | Add semantic dedup before finding storage |
| `apps/api/src/lib/ai-stream.ts` | Update conversation embedding to use new pipeline |
| `apps/api/src/app.ts` | Mount new search and suggestions routes |
| `apps/desktop/src/api/omnibar.ts` | Switch search to `/api/search` endpoint |
| `apps/desktop/src/api/things.ts` | Add hooks for suggestions and list-suggestions |
| `packages/ui/src/Omnibar.tsx` | Render multi-type search results |
| `packages/ui/src/SpotlightModal.tsx` | Render multi-type search results (keep in sync with Omnibar) |
| `packages/ui/src/LinkedItemsList.tsx` | Add suggested items section, auto-link indicator |
| `packages/ui/src/TaskDetailPanel.tsx` | Pass suggestions props |
| `packages/ui/src/ContentDetailPanel.tsx` | Pass suggestions props |
| `packages/ui/src/CalendarEventDetailPanel.tsx` | Add related items section, meeting history |
| `packages/ui/src/TriagePopup.tsx` | Add list suggestions display |
| `packages/ai/src/context/assembler.ts` | Add embedding context for briefing, take, and thread |

---

## Task 1: EmbeddingProvider Interface + Voyage Provider

**Files:**
- Modify: `packages/ai/src/providers/types.ts:47-50`
- Create: `packages/ai/src/providers/voyage.ts`

- [ ] **Step 1: Install Voyage AI SDK**

```bash
cd /Users/brentbarkman/code/brett && pnpm --filter @brett/ai add voyageai
```

- [ ] **Step 2: Update EmbeddingProvider interface**

In `packages/ai/src/providers/types.ts`, replace lines 47-50:

```typescript
export interface EmbeddingProvider {
  embed(text: string, inputType?: "query" | "document"): Promise<number[]>;
  embedBatch(texts: string[], inputType?: "query" | "document"): Promise<number[][]>;
  readonly dimensions: number;
}
```

- [ ] **Step 3: Update OpenAIEmbeddingProvider to match new interface**

In `packages/ai/src/providers/embedding.ts`, add the `inputType` param (ignored) and `embedBatch`:

```typescript
import OpenAI from "openai";
import type { EmbeddingProvider } from "./types.js";

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions = 1536;
  private client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }

  async embed(text: string, _inputType?: "query" | "document"): Promise<number[]> {
    const response = await this.client.embeddings.create({
      model: "text-embedding-3-small",
      input: text,
    });
    return response.data[0].embedding;
  }

  async embedBatch(texts: string[], _inputType?: "query" | "document"): Promise<number[][]> {
    const response = await this.client.embeddings.create({
      model: "text-embedding-3-small",
      input: texts,
    });
    return response.data.map((d) => d.embedding);
  }
}
```

- [ ] **Step 4: Build VoyageEmbeddingProvider**

Create `packages/ai/src/providers/voyage.ts`:

```typescript
import { VoyageAIClient } from "voyageai";
import type { EmbeddingProvider } from "./types.js";

export class VoyageEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions = 1024;
  private client: VoyageAIClient;

  constructor(apiKey: string) {
    this.client = new VoyageAIClient({ apiKey });
  }

  async embed(text: string, inputType?: "query" | "document"): Promise<number[]> {
    const result = await this.client.embed({
      input: [text],
      model: "voyage-3-large",
      inputType: inputType ?? "document",
    });
    return result.data![0].embedding!;
  }

  async embedBatch(texts: string[], inputType?: "query" | "document"): Promise<number[][]> {
    const result = await this.client.embed({
      input: texts,
      model: "voyage-3-large",
      inputType: inputType ?? "document",
    });
    return result.data!.map((d) => d.embedding!);
  }
}
```

- [ ] **Step 5: Verify types compile**

```bash
cd /Users/brentbarkman/code/brett && pnpm --filter @brett/ai typecheck
```

- [ ] **Step 6: Commit**

```bash
git add packages/ai/src/providers/types.ts packages/ai/src/providers/embedding.ts packages/ai/src/providers/voyage.ts
git commit -m "feat(ai): add VoyageEmbeddingProvider with asymmetric search support"
```

---

## Task 2: MockEmbeddingProvider with Semantic Clusters

**Files:**
- Create: `packages/ai/src/providers/mock-embedding.ts`
- Create: `packages/ai/src/__tests__/mock-embedding.test.ts`

- [ ] **Step 1: Write tests for mock provider**

Create `packages/ai/src/__tests__/mock-embedding.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { MockEmbeddingProvider, cosineSimilarity } from "../providers/mock-embedding.js";

describe("MockEmbeddingProvider", () => {
  const provider = new MockEmbeddingProvider();

  it("returns vectors of correct dimensions", async () => {
    const vector = await provider.embed("test text");
    expect(vector).toHaveLength(1024);
    expect(vector.every((n) => typeof n === "number" && Number.isFinite(n))).toBe(true);
  });

  it("returns deterministic vectors for same input", async () => {
    const v1 = await provider.embed("budget review");
    const v2 = await provider.embed("budget review");
    expect(v1).toEqual(v2);
  });

  it("returns different vectors for different input", async () => {
    const v1 = await provider.embed("budget review");
    const v2 = await provider.embed("dentist appointment");
    expect(v1).not.toEqual(v2);
  });

  describe("semantic clusters", () => {
    it("finance cluster: within-cluster similarity > 0.88", async () => {
      const v1 = await provider.embed("budget review");
      const v2 = await provider.embed("Q3 financials");
      expect(cosineSimilarity(v1, v2)).toBeGreaterThan(0.88);
    });

    it("finance cluster: all pairs are high similarity", async () => {
      const v1 = await provider.embed("budget review");
      const v2 = await provider.embed("Q3 financials");
      const v3 = await provider.embed("revenue forecast");
      expect(cosineSimilarity(v1, v3)).toBeGreaterThan(0.88);
      expect(cosineSimilarity(v2, v3)).toBeGreaterThan(0.88);
    });

    it("hiring cluster: within-cluster similarity > 0.85", async () => {
      const v1 = await provider.embed("engineering hiring");
      const v2 = await provider.embed("interview pipeline");
      expect(cosineSimilarity(v1, v2)).toBeGreaterThan(0.85);
    });

    it("cross-cluster similarity is moderate (0.40-0.55)", async () => {
      const finance = await provider.embed("budget review");
      const hiring = await provider.embed("engineering hiring");
      const sim = cosineSimilarity(finance, hiring);
      expect(sim).toBeGreaterThan(0.35);
      expect(sim).toBeLessThan(0.60);
    });

    it("outlier has low similarity to all clusters (< 0.30)", async () => {
      const finance = await provider.embed("budget review");
      const hiring = await provider.embed("engineering hiring");
      const outlier = await provider.embed("dentist appointment");
      expect(cosineSimilarity(finance, outlier)).toBeLessThan(0.30);
      expect(cosineSimilarity(hiring, outlier)).toBeLessThan(0.30);
    });

    it("near-duplicate pair similarity > 0.96", async () => {
      const v1 = await provider.embed("Review Q3 budget");
      const v2 = await provider.embed("Q3 budget review");
      expect(cosineSimilarity(v1, v2)).toBeGreaterThan(0.96);
    });

    it("borderline pair similarity between 0.75 and 0.90", async () => {
      const v1 = await provider.embed("Prepare financial summary");
      const v2 = await provider.embed("Revenue dashboard update");
      const sim = cosineSimilarity(v1, v2);
      expect(sim).toBeGreaterThan(0.75);
      expect(sim).toBeLessThan(0.90);
    });
  });

  describe("embedBatch", () => {
    it("returns correct number of vectors", async () => {
      const vectors = await provider.embedBatch(["text one", "text two", "text three"]);
      expect(vectors).toHaveLength(3);
      vectors.forEach((v) => expect(v).toHaveLength(1024));
    });

    it("batch results match individual results", async () => {
      const individual = await provider.embed("budget review");
      const batch = await provider.embedBatch(["budget review"]);
      expect(batch[0]).toEqual(individual);
    });
  });

  describe("inputType", () => {
    it("accepts query and document input types without error", async () => {
      const vQuery = await provider.embed("budget", "query");
      const vDoc = await provider.embed("budget", "document");
      expect(vQuery).toHaveLength(1024);
      expect(vDoc).toHaveLength(1024);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/brentbarkman/code/brett && pnpm --filter @brett/ai test -- src/__tests__/mock-embedding.test.ts
```

Expected: FAIL — module not found

- [ ] **Step 3: Build MockEmbeddingProvider**

Create `packages/ai/src/providers/mock-embedding.ts`:

```typescript
import type { EmbeddingProvider } from "./types.js";

/**
 * Cosine similarity between two vectors.
 * Exported for use in tests.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

// --- Semantic cluster definitions ---
// Each cluster is a "seed" vector. Texts matching a cluster keyword get
// a vector near the seed. The seed vectors are constructed so that
// within-cluster cosine similarity is high and cross-cluster is low.

const DIMS = 1024;

function makeSeed(clusterIndex: number, dims: number): number[] {
  // Each cluster occupies a different region of the vector space.
  // We assign strong signal in a dedicated subspace (64 dims per cluster)
  // and small random-ish noise elsewhere for realism.
  const vec = new Array(dims).fill(0);
  const subspaceStart = clusterIndex * 64;
  for (let i = 0; i < 64; i++) {
    vec[subspaceStart + i] = 1.0;
  }
  // Add small deterministic noise to non-subspace dims
  for (let i = 0; i < dims; i++) {
    if (i < subspaceStart || i >= subspaceStart + 64) {
      vec[i] = 0.01 * Math.sin(i * 0.1 + clusterIndex);
    }
  }
  return normalize(vec);
}

function normalize(vec: number[]): number[] {
  const mag = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
  return vec.map((v) => v / mag);
}

function perturbVector(seed: number[], amount: number, perturbSeed: number): number[] {
  const vec = seed.map((v, i) => v + amount * Math.sin(i * 0.7 + perturbSeed * 3.14));
  return normalize(vec);
}

function hashString(s: string): number {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) - hash + s.charCodeAt(i)) | 0;
  }
  return hash;
}

// Cluster seeds
const FINANCE_SEED = makeSeed(0, DIMS);
const HIRING_SEED = makeSeed(1, DIMS);
const OUTLIER_SEED = makeSeed(2, DIMS);

// Cluster membership: keyword → { seed, perturbAmount }
// perturbAmount controls how close to the seed (lower = closer = higher similarity)
const CLUSTERS: Array<{ keywords: string[]; seed: number[]; perturbAmount: number }> = [
  {
    keywords: ["budget review", "Q3 financials", "revenue forecast", "Review Q3 budget", "Q3 budget review"],
    seed: FINANCE_SEED,
    perturbAmount: 0.08,
  },
  {
    keywords: ["Prepare financial summary", "Revenue dashboard update"],
    seed: FINANCE_SEED,
    perturbAmount: 0.35, // borderline — close to finance but not tight
  },
  {
    keywords: ["engineering hiring", "interview pipeline", "recruiter sync"],
    seed: HIRING_SEED,
    perturbAmount: 0.10,
  },
  {
    keywords: ["dentist appointment"],
    seed: OUTLIER_SEED,
    perturbAmount: 0.05,
  },
];

// Near-duplicate pair gets extra-tight perturbation
const NEAR_DUPLICATES = new Map<string, number>([
  ["Review Q3 budget", 0.01],
  ["Q3 budget review", 0.015],
]);

function findCluster(text: string): { seed: number[]; perturbAmount: number } | null {
  for (const cluster of CLUSTERS) {
    if (cluster.keywords.includes(text)) {
      const nearDupAmount = NEAR_DUPLICATES.get(text);
      return {
        seed: cluster.seed,
        perturbAmount: nearDupAmount ?? cluster.perturbAmount,
      };
    }
  }
  return null;
}

/**
 * MockEmbeddingProvider for testing.
 *
 * Returns deterministic vectors with known semantic relationships:
 * - Finance cluster: "budget review", "Q3 financials", "revenue forecast" (sim > 0.88)
 * - Hiring cluster: "engineering hiring", "interview pipeline", "recruiter sync" (sim > 0.85)
 * - Cross-cluster: finance ↔ hiring (sim 0.40-0.55)
 * - Outlier: "dentist appointment" (sim < 0.30 to all clusters)
 * - Near-duplicates: "Review Q3 budget" / "Q3 budget review" (sim > 0.96)
 * - Borderline: "Prepare financial summary" / "Revenue dashboard update" (sim 0.75-0.90)
 *
 * Unknown text falls back to hash-based deterministic vectors.
 */
export class MockEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions = DIMS;

  async embed(text: string, _inputType?: "query" | "document"): Promise<number[]> {
    const cluster = findCluster(text);
    if (cluster) {
      return perturbVector(cluster.seed, cluster.perturbAmount, hashString(text));
    }
    // Fallback: hash-based deterministic vector in a neutral region
    return this.hashVector(text);
  }

  async embedBatch(texts: string[], inputType?: "query" | "document"): Promise<number[][]> {
    return Promise.all(texts.map((t) => this.embed(t, inputType)));
  }

  private hashVector(text: string): number[] {
    const h = hashString(text);
    const vec = new Array(DIMS).fill(0);
    for (let i = 0; i < DIMS; i++) {
      vec[i] = Math.sin(h * 0.001 + i * 0.1);
    }
    return normalize(vec);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /Users/brentbarkman/code/brett && pnpm --filter @brett/ai test -- src/__tests__/mock-embedding.test.ts
```

Expected: ALL PASS. If similarity ranges are off, tune `perturbAmount` values.

- [ ] **Step 5: Commit**

```bash
git add packages/ai/src/providers/mock-embedding.ts packages/ai/src/__tests__/mock-embedding.test.ts
git commit -m "test(ai): add MockEmbeddingProvider with semantic clusters for threshold testing"
```

---

## Task 3: Config + Schema Migration

**Files:**
- Modify: `packages/ai/src/config.ts`
- Modify: `apps/api/prisma/schema.prisma`
- New migration via `pnpm db:migrate`

- [ ] **Step 1: Update AI_CONFIG**

In `packages/ai/src/config.ts`, replace the entire file:

```typescript
export const AI_CONFIG = {
  orchestrator: {
    maxRounds: 5,
    maxTotalTokens: 50_000,
    maxToolResultSize: 4096,
  },
  context: {
    maxFacts: 20,
    maxPastSessions: 3,
    maxMessagesPerSession: 15,
  },
  memory: {
    maxFactValueLength: 200,
    maxEmbeddingTextLength: 8000,
    embeddingDimensions: 1024,
  },
  embedding: {
    provider: "voyage" as const,
    model: "voyage-3-large" as const,
    dimensions: 1024,
    maxChunkTokens: 500,
    chunkOverlapTokens: 50,
    maxTextLength: 8000,
    autoLinkThreshold: 0.90,
    suggestThreshold: 0.75,
    dupThreshold: 0.85,
    crossTypeThreshold: 0.70,
    scoutDedupThreshold: 0.88,
    searchResultLimit: 20,
    batchSize: 50,
    debounceMs: 500,
    maxRetries: 3,
  },
  rateLimit: {
    aiStreaming: 30,
    aiConfig: 5,
    nonStreaming: 100,
  },
} as const;
```

- [ ] **Step 2: Add Embedding model to Prisma schema**

In `apps/api/prisma/schema.prisma`, add the `Embedding` model after the `ConversationEmbedding` model (around line 455), and add the `source` field to `ItemLink`:

Add to `ItemLink` model (after line 205, before `createdAt`):

```prisma
  source     String   @default("manual") // "manual" | "embedding"
```

Add the new `Embedding` model:

```prisma
model Embedding {
  id         String   @id @default(cuid())
  userId     String
  user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  entityType String   // "item" | "calendar_event" | "meeting_note" | "scout_finding" | "conversation"
  entityId   String
  chunkIndex Int      @default(0)
  chunkText  String   @db.Text
  embedding  Unsupported("vector(1024)")
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  @@unique([entityType, entityId, chunkIndex])
  @@index([userId])
}
```

Add the `Embedding` relation to the `User` model (alongside other relations):

```prisma
  embeddings         Embedding[]
```

- [ ] **Step 3: Create migration**

```bash
cd /Users/brentbarkman/code/brett && pnpm db:migrate --name add_universal_embedding_table
```

- [ ] **Step 4: Add HNSW index via manual SQL**

Edit the generated migration file to append after the auto-generated SQL:

```sql
-- HNSW index for vector similarity search on universal Embedding table
CREATE INDEX IF NOT EXISTS embedding_vector_idx
ON "Embedding" USING hnsw (embedding vector_cosine_ops);
```

- [ ] **Step 5: Run migration**

```bash
cd /Users/brentbarkman/code/brett && pnpm db:migrate
```

- [ ] **Step 6: Verify schema compiles**

```bash
cd /Users/brentbarkman/code/brett && pnpm --filter @brett/api typecheck
```

- [ ] **Step 7: Commit**

```bash
git add apps/api/prisma/ packages/ai/src/config.ts
git commit -m "feat(db): add universal Embedding table with HNSW index and ItemLink source field"
```

---

## Task 4: Text Assemblers

**Files:**
- Create: `packages/ai/src/embedding/assembler.ts`
- Create: `packages/ai/src/__tests__/assembler.test.ts`

- [ ] **Step 1: Write tests for text assemblers**

Create `packages/ai/src/__tests__/assembler.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { assembleItemText, assembleContentText, assembleEventText, assembleMeetingNoteText, assembleFindingText, assembleConversationText } from "../embedding/assembler.js";

describe("assembleItemText", () => {
  it("assembles task with all fields", () => {
    const result = assembleItemText({
      title: "Review budget",
      description: "Check Q3 numbers",
      notes: "Ask Jordan about forecasts",
      type: "task",
    });
    expect(result).toEqual(["[Task] Review budget\nCheck Q3 numbers\nAsk Jordan about forecasts"]);
  });

  it("handles null description and notes", () => {
    const result = assembleItemText({ title: "Simple task", description: null, notes: null, type: "task" });
    expect(result).toEqual(["[Task] Simple task"]);
  });

  it("handles empty strings by omitting them", () => {
    const result = assembleItemText({ title: "Task", description: "", notes: "", type: "task" });
    expect(result).toEqual(["[Task] Task"]);
  });
});

describe("assembleContentText", () => {
  it("returns metadata chunk and body chunks for content with body", () => {
    const longBody = "Paragraph one about finance.\n\n".repeat(50);
    const result = assembleContentText({
      title: "Saved article",
      contentType: "article",
      contentTitle: "The Future of Finance",
      contentDescription: "An overview of fintech trends",
      contentBody: longBody,
      type: "content",
    });
    expect(result.length).toBeGreaterThan(1);
    expect(result[0]).toContain("[Content: article]");
    expect(result[0]).toContain("The Future of Finance");
  });

  it("returns single chunk for content without body", () => {
    const result = assembleContentText({
      title: "Bookmark",
      contentType: "web_page",
      contentTitle: "Cool site",
      contentDescription: null,
      contentBody: null,
      type: "content",
    });
    expect(result).toHaveLength(1);
    expect(result[0]).toContain("[Content: web_page]");
  });
});

describe("assembleEventText", () => {
  it("assembles event with all fields", () => {
    const result = assembleEventText({
      title: "1:1 with Jordan",
      description: "Weekly sync on hiring",
      location: "Zoom",
    });
    expect(result).toEqual(["[Meeting] 1:1 with Jordan\nWeekly sync on hiring\nLocation: Zoom"]);
  });

  it("omits null description and location", () => {
    const result = assembleEventText({ title: "Standup", description: null, location: null });
    expect(result).toEqual(["[Meeting] Standup"]);
  });
});

describe("assembleMeetingNoteText", () => {
  it("returns metadata chunk and transcript chunks", () => {
    const transcript = Array.from({ length: 100 }, (_, i) => ({
      speaker: i % 2 === 0 ? "Jordan" : "Me",
      text: `This is line ${i} of the transcript about Q3 planning and budget allocations.`,
    }));
    const result = assembleMeetingNoteText({
      title: "1:1 with Jordan",
      summary: "Discussed Q3 hiring plan",
      transcript,
    });
    expect(result.length).toBeGreaterThan(1);
    expect(result[0]).toContain("[Meeting Notes]");
    expect(result[0]).toContain("Discussed Q3 hiring plan");
  });
});

describe("assembleFindingText", () => {
  it("assembles finding with all fields", () => {
    const result = assembleFindingText({
      title: "Apple announces AI features",
      description: "Apple revealed new AI capabilities at WWDC",
      reasoning: "Relevant to user's scout tracking AI industry news",
    });
    expect(result).toEqual([
      "[Scout Finding] Apple announces AI features\nApple revealed new AI capabilities at WWDC\nRelevance: Relevant to user's scout tracking AI industry news",
    ]);
  });
});

describe("assembleConversationText", () => {
  it("concatenates user and assistant messages", () => {
    const result = assembleConversationText([
      { role: "user", content: "What's on my calendar?" },
      { role: "assistant", content: "You have 3 meetings today." },
    ]);
    expect(result).toEqual(["user: What's on my calendar?\n\nassistant: You have 3 meetings today."]);
  });

  it("filters out tool_call and tool_result roles", () => {
    const result = assembleConversationText([
      { role: "user", content: "Create a task" },
      { role: "tool_call", content: '{"name":"create_task"}' },
      { role: "tool_result", content: '{"success":true}' },
      { role: "assistant", content: "Done!" },
    ]);
    expect(result).toEqual(["user: Create a task\n\nassistant: Done!"]);
  });

  it("truncates to maxTextLength", () => {
    const longContent = "a".repeat(10000);
    const result = assembleConversationText([{ role: "user", content: longContent }]);
    expect(result[0].length).toBeLessThanOrEqual(8000);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/brentbarkman/code/brett && pnpm --filter @brett/ai test -- src/__tests__/assembler.test.ts
```

Expected: FAIL — modules not found

- [ ] **Step 3: Build text assemblers**

Create `packages/ai/src/embedding/assembler.ts`:

```typescript
import { AI_CONFIG } from "../config.js";
import { chunkText } from "./chunker.js";

interface ItemInput {
  title: string;
  description: string | null;
  notes: string | null;
  type: string;
}

interface ContentInput {
  title: string;
  contentType: string | null;
  contentTitle: string | null;
  contentDescription: string | null;
  contentBody: string | null;
  type: string;
}

interface EventInput {
  title: string;
  description: string | null;
  location: string | null;
}

interface MeetingNoteInput {
  title: string;
  summary: string | null;
  transcript: Array<{ speaker: string; text: string }> | null;
}

interface FindingInput {
  title: string;
  description: string;
  reasoning: string;
}

interface MessageInput {
  role: string;
  content: string;
}

function joinNonEmpty(...parts: (string | null | undefined)[]): string {
  return parts.filter((p) => p != null && p !== "").join("\n");
}

/** Assemble text for a task item. Returns a single-element array. */
export function assembleItemText(item: ItemInput): string[] {
  return [joinNonEmpty(`[Task] ${item.title}`, item.description, item.notes)];
}

/** Assemble text for a content item. Returns metadata chunk + body chunks. */
export function assembleContentText(item: ContentInput): string[] {
  const typeLabel = item.contentType ?? "content";
  const metaParts = [item.title, item.contentTitle, item.contentDescription].filter((p) => p != null && p !== "");
  const metaChunk = `[Content: ${typeLabel}] ${metaParts.join(" — ")}`;
  const chunks = [metaChunk];

  if (item.contentBody) {
    const bodyChunks = chunkText(item.contentBody);
    chunks.push(...bodyChunks);
  }

  return chunks;
}

/** Assemble text for a calendar event. Returns a single-element array. */
export function assembleEventText(event: EventInput): string[] {
  const location = event.location ? `Location: ${event.location}` : null;
  return [joinNonEmpty(`[Meeting] ${event.title}`, event.description, location)];
}

/** Assemble text for a meeting note. Returns metadata chunk + transcript chunks. */
export function assembleMeetingNoteText(note: MeetingNoteInput): string[] {
  const metaChunk = joinNonEmpty(`[Meeting Notes] ${note.title}`, note.summary ? `${note.summary}` : null);
  const chunks = [metaChunk];

  if (note.transcript && note.transcript.length > 0) {
    const transcriptText = note.transcript.map((t) => `${t.speaker}: ${t.text}`).join("\n");
    const transcriptChunks = chunkText(transcriptText);
    chunks.push(...transcriptChunks);
  }

  return chunks;
}

/** Assemble text for a scout finding. Returns a single-element array. */
export function assembleFindingText(finding: FindingInput): string[] {
  return [joinNonEmpty(`[Scout Finding] ${finding.title}`, finding.description, `Relevance: ${finding.reasoning}`)];
}

/** Assemble text for a conversation. Returns a single-element array (truncated). */
export function assembleConversationText(messages: MessageInput[]): string[] {
  const relevant = messages.filter((m) => m.role === "user" || m.role === "assistant");
  if (relevant.length === 0) return [];
  const text = relevant.map((m) => `${m.role}: ${m.content}`).join("\n\n");
  const truncated = text.slice(0, AI_CONFIG.memory.maxEmbeddingTextLength);
  return [truncated];
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /Users/brentbarkman/code/brett && pnpm --filter @brett/ai test -- src/__tests__/assembler.test.ts
```

Note: This will fail because `chunker.ts` doesn't exist yet. That's expected — we build it in the next task.

- [ ] **Step 5: Commit assembler (tests will pass after Task 5)**

```bash
git add packages/ai/src/embedding/assembler.ts packages/ai/src/__tests__/assembler.test.ts
git commit -m "feat(ai): add text assemblers for all entity types"
```

---

## Task 5: Chunking Algorithm

**Files:**
- Create: `packages/ai/src/embedding/chunker.ts`
- Create: `packages/ai/src/__tests__/chunker.test.ts`

- [ ] **Step 1: Write tests for chunker**

Create `packages/ai/src/__tests__/chunker.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { chunkText, estimateTokens } from "../embedding/chunker.js";

describe("estimateTokens", () => {
  it("estimates ~1 token per 4 chars", () => {
    expect(estimateTokens("hello world")).toBe(3); // 11 chars / 4 ≈ 3
  });

  it("returns 0 for empty string", () => {
    expect(estimateTokens("")).toBe(0);
  });
});

describe("chunkText", () => {
  it("returns single chunk for short text", () => {
    const text = "This is a short paragraph.";
    const chunks = chunkText(text);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toBe(text);
  });

  it("splits on paragraph boundaries", () => {
    const para = "Word ".repeat(400); // ~400 tokens
    const text = `${para}\n\n${para}`;
    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
  });

  it("splits long paragraphs on sentence boundaries", () => {
    const sentence = "This is a test sentence about financial planning. ";
    const longPara = sentence.repeat(100); // one giant paragraph
    const chunks = chunkText(longPara);
    expect(chunks.length).toBeGreaterThan(1);
    chunks.forEach((chunk) => {
      expect(estimateTokens(chunk)).toBeLessThanOrEqual(550); // some tolerance
    });
  });

  it("adds overlap between chunks", () => {
    const para = "Unique content block number one. ".repeat(80);
    const text = `${para}\n\n${para}`;
    const chunks = chunkText(text);
    if (chunks.length >= 2) {
      // Last portion of chunk N should appear at start of chunk N+1
      const endOfFirst = chunks[0].slice(-50);
      expect(chunks[1]).toContain(endOfFirst.trim().split(" ").slice(-3).join(" "));
    }
  });

  it("handles empty input", () => {
    expect(chunkText("")).toEqual([]);
  });

  it("handles text with no paragraph breaks", () => {
    const text = "word ".repeat(1000);
    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThan(1);
  });

  it("respects maxTextLength per chunk", () => {
    const text = "a".repeat(20000);
    const chunks = chunkText(text);
    chunks.forEach((chunk) => {
      expect(chunk.length).toBeLessThanOrEqual(8000);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/brentbarkman/code/brett && pnpm --filter @brett/ai test -- src/__tests__/chunker.test.ts
```

- [ ] **Step 3: Build chunker**

Create `packages/ai/src/embedding/chunker.ts`:

```typescript
import { AI_CONFIG } from "../config.js";

const { maxChunkTokens, chunkOverlapTokens, maxTextLength } = AI_CONFIG.embedding;

/** Rough token estimation: ~4 chars per token. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Split text into chunks of ~maxChunkTokens with overlap.
 * Splits on paragraph boundaries first, then sentences if needed.
 */
export function chunkText(text: string): string[] {
  if (!text || text.trim().length === 0) return [];

  const totalTokens = estimateTokens(text);
  if (totalTokens <= maxChunkTokens) {
    return [text.slice(0, maxTextLength)];
  }

  // Split into paragraphs
  const paragraphs = text.split(/\n\n+/).filter((p) => p.trim().length > 0);

  // Split any paragraph that exceeds maxChunkTokens into sentences
  const segments: string[] = [];
  for (const para of paragraphs) {
    if (estimateTokens(para) <= maxChunkTokens) {
      segments.push(para);
    } else {
      const sentences = para.split(/(?<=\.)\s+/).filter((s) => s.trim().length > 0);
      segments.push(...sentences);
    }
  }

  // Accumulate segments into chunks
  const chunks: string[] = [];
  let currentChunk = "";
  let overlapBuffer = "";

  for (const segment of segments) {
    const candidate = currentChunk ? `${currentChunk}\n\n${segment}` : segment;

    if (estimateTokens(candidate) > maxChunkTokens && currentChunk.length > 0) {
      // Flush current chunk
      chunks.push(currentChunk.slice(0, maxTextLength));

      // Compute overlap: take last ~chunkOverlapTokens worth of chars
      const overlapChars = chunkOverlapTokens * 4;
      overlapBuffer = currentChunk.slice(-overlapChars);

      // Start new chunk with overlap + current segment
      currentChunk = overlapBuffer ? `${overlapBuffer}\n\n${segment}` : segment;
    } else {
      currentChunk = candidate;
    }
  }

  // Flush remaining
  if (currentChunk.trim().length > 0) {
    chunks.push(currentChunk.slice(0, maxTextLength));
  }

  return chunks;
}
```

- [ ] **Step 4: Run chunker tests AND assembler tests (assembler depends on chunker)**

```bash
cd /Users/brentbarkman/code/brett && pnpm --filter @brett/ai test -- src/__tests__/chunker.test.ts src/__tests__/assembler.test.ts
```

Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add packages/ai/src/embedding/chunker.ts packages/ai/src/__tests__/chunker.test.ts
git commit -m "feat(ai): add text chunking algorithm with paragraph/sentence splitting and overlap"
```

---

## Task 6: Embedding Pipeline (Queue + Store)

**Files:**
- Create: `packages/ai/src/embedding/pipeline.ts`
- Create: `packages/ai/src/embedding/queue.ts`
- Create: `apps/api/src/lib/embedding-provider.ts`
- Modify: `packages/ai/src/index.ts`

- [ ] **Step 1: Build the server-side embedding provider singleton**

Create `apps/api/src/lib/embedding-provider.ts`:

```typescript
import { VoyageEmbeddingProvider } from "@brett/ai";
import { MockEmbeddingProvider } from "@brett/ai";
import type { EmbeddingProvider } from "@brett/ai";

let provider: EmbeddingProvider | null = null;

export function getEmbeddingProvider(): EmbeddingProvider | null {
  if (provider) return provider;

  const apiKey = process.env.EMBEDDING_API_KEY;
  if (!apiKey) return null;

  provider = new VoyageEmbeddingProvider(apiKey);
  return provider;
}

/** For tests: inject a mock provider */
export function setEmbeddingProvider(p: EmbeddingProvider | null): void {
  provider = p;
}
```

- [ ] **Step 2: Build the embedding queue**

Create `packages/ai/src/embedding/queue.ts`:

```typescript
import { AI_CONFIG } from "../config.js";

export interface EmbedJob {
  entityType: string;
  entityId: string;
  userId: string;
}

type JobProcessor = (job: EmbedJob) => Promise<void>;

const pending = new Map<string, NodeJS.Timeout>();
let processor: JobProcessor | null = null;

function jobKey(job: EmbedJob): string {
  return `${job.entityType}:${job.entityId}`;
}

/** Register the processor function. Called once at startup. */
export function setEmbedProcessor(fn: JobProcessor): void {
  processor = fn;
}

/**
 * Enqueue an embedding job. Debounces rapid updates to the same entity.
 * Fire-and-forget — never throws, logs errors.
 */
export function enqueueEmbed(job: EmbedJob): void {
  if (!processor) return;

  const key = jobKey(job);
  const existing = pending.get(key);
  if (existing) clearTimeout(existing);

  const timeout = setTimeout(async () => {
    pending.delete(key);
    if (!processor) return;

    let attempt = 0;
    while (attempt < AI_CONFIG.embedding.maxRetries) {
      try {
        await processor(job);
        return;
      } catch (err) {
        attempt++;
        if (attempt < AI_CONFIG.embedding.maxRetries) {
          await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));
        } else {
          console.error(`[embedding] Failed after ${attempt} attempts for ${key}:`, err);
        }
      }
    }
  }, AI_CONFIG.embedding.debounceMs);

  pending.set(key, timeout);
}

/** For testing: flush all pending jobs immediately */
export async function flushEmbedQueue(): Promise<void> {
  for (const [key, timeout] of pending) {
    clearTimeout(timeout);
    pending.delete(key);
    if (processor) {
      await processor({
        entityType: key.split(":")[0],
        entityId: key.split(":").slice(1).join(":"),
        userId: "",
      });
    }
  }
}
```

- [ ] **Step 3: Build the embedding pipeline**

Create `packages/ai/src/embedding/pipeline.ts`:

```typescript
import type { PrismaClient } from "@prisma/client";
import type { EmbeddingProvider } from "../providers/types.js";
import { AI_CONFIG } from "../config.js";
import {
  assembleItemText,
  assembleContentText,
  assembleEventText,
  assembleMeetingNoteText,
  assembleFindingText,
  assembleConversationText,
} from "./assembler.js";

interface EmbedEntityParams {
  entityType: string;
  entityId: string;
  userId: string;
  provider: EmbeddingProvider;
  prisma: PrismaClient;
}

/**
 * Embed a single entity: load it, assemble text, generate embeddings, upsert.
 */
export async function embedEntity(params: EmbedEntityParams): Promise<void> {
  const { entityType, entityId, userId, provider, prisma } = params;

  // 1. Load entity and assemble text chunks
  const chunks = await loadAndAssemble(entityType, entityId, userId, prisma);
  if (chunks.length === 0) return;

  // 2. Generate embeddings (batch)
  const vectors = await provider.embedBatch(chunks, "document");

  // 3. Validate vectors
  for (const vec of vectors) {
    if (!Array.isArray(vec) || vec.length !== AI_CONFIG.embedding.dimensions) return;
    if (!vec.every((n) => typeof n === "number" && Number.isFinite(n))) return;
  }

  // 4. Upsert embeddings
  for (let i = 0; i < chunks.length; i++) {
    const vectorStr = `[${vectors[i].join(",")}]`;
    await prisma.$executeRaw`
      INSERT INTO "Embedding" (id, "userId", "entityType", "entityId", "chunkIndex", "chunkText", embedding, "createdAt", "updatedAt")
      VALUES (gen_random_uuid(), ${userId}, ${entityType}, ${entityId}, ${i}, ${chunks[i]}, ${vectorStr}::vector, NOW(), NOW())
      ON CONFLICT ("entityType", "entityId", "chunkIndex")
      DO UPDATE SET "chunkText" = ${chunks[i]}, embedding = ${vectorStr}::vector, "updatedAt" = NOW()
    `;
  }

  // 5. Delete orphaned chunks (if chunk count decreased)
  await prisma.$executeRaw`
    DELETE FROM "Embedding"
    WHERE "entityType" = ${entityType} AND "entityId" = ${entityId} AND "chunkIndex" >= ${chunks.length}
  `;
}

/** Delete all embeddings for an entity. Call before or in same transaction as entity deletion. */
export async function deleteEmbeddings(
  entityType: string,
  entityId: string,
  prisma: PrismaClient,
): Promise<void> {
  await prisma.$executeRaw`
    DELETE FROM "Embedding" WHERE "entityType" = ${entityType} AND "entityId" = ${entityId}
  `;
}

async function loadAndAssemble(
  entityType: string,
  entityId: string,
  userId: string,
  prisma: PrismaClient,
): Promise<string[]> {
  switch (entityType) {
    case "item": {
      const item = await prisma.item.findFirst({
        where: { id: entityId, userId },
        select: { title: true, description: true, notes: true, type: true, contentType: true, contentTitle: true, contentDescription: true, contentBody: true },
      });
      if (!item) return [];
      if (item.type === "content") {
        return assembleContentText({
          title: item.title,
          contentType: item.contentType,
          contentTitle: item.contentTitle,
          contentDescription: item.contentDescription,
          contentBody: item.contentBody,
          type: item.type,
        });
      }
      return assembleItemText({ title: item.title, description: item.description, notes: item.notes, type: item.type });
    }

    case "calendar_event": {
      const event = await prisma.calendarEvent.findFirst({
        where: { id: entityId, userId },
        select: { title: true, description: true, location: true },
      });
      if (!event) return [];
      return assembleEventText(event);
    }

    case "meeting_note": {
      const note = await prisma.meetingNote.findFirst({
        where: { id: entityId, userId },
        select: { title: true, summary: true, transcript: true },
      });
      if (!note) return [];
      const transcript = Array.isArray(note.transcript)
        ? (note.transcript as Array<{ speaker: string; text: string }>)
        : null;
      return assembleMeetingNoteText({ title: note.title, summary: note.summary, transcript });
    }

    case "scout_finding": {
      const finding = await prisma.scoutFinding.findFirst({
        where: { id: entityId },
        include: { scout: { select: { userId: true } } },
      });
      if (!finding || finding.scout.userId !== userId) return [];
      return assembleFindingText({ title: finding.title, description: finding.description, reasoning: finding.reasoning });
    }

    case "conversation": {
      const messages = await prisma.conversationMessage.findMany({
        where: { sessionId: entityId },
        orderBy: { createdAt: "asc" },
        select: { role: true, content: true },
      });
      return assembleConversationText(messages);
    }

    default:
      return [];
  }
}
```

- [ ] **Step 4: Update package exports**

In `packages/ai/src/index.ts`, add these exports (alongside existing ones):

```typescript
// Embedding system
export { VoyageEmbeddingProvider } from "./providers/voyage.js";
export { MockEmbeddingProvider, cosineSimilarity } from "./providers/mock-embedding.js";
export { embedEntity, deleteEmbeddings } from "./embedding/pipeline.js";
export { enqueueEmbed, setEmbedProcessor, flushEmbedQueue } from "./embedding/queue.js";
export { assembleItemText, assembleContentText, assembleEventText, assembleMeetingNoteText, assembleFindingText, assembleConversationText } from "./embedding/assembler.js";
export { chunkText, estimateTokens } from "./embedding/chunker.js";
```

- [ ] **Step 5: Typecheck everything**

```bash
cd /Users/brentbarkman/code/brett && pnpm typecheck
```

- [ ] **Step 6: Commit**

```bash
git add packages/ai/src/embedding/ packages/ai/src/index.ts apps/api/src/lib/embedding-provider.ts
git commit -m "feat(ai): add embedding pipeline with async queue, entity loading, and batch upsert"
```

---

## Task 7: Hybrid Search (Keyword + Vector + RRF)

**Files:**
- Create: `packages/ai/src/embedding/search.ts`
- Create: `packages/ai/src/__tests__/search.test.ts`

- [ ] **Step 1: Write tests for RRF fusion**

Create `packages/ai/src/__tests__/search.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { fuseResults, type RankedResult } from "../embedding/search.js";

describe("fuseResults (Reciprocal Rank Fusion)", () => {
  it("merges two lists with shared results ranked higher", () => {
    const keyword: RankedResult[] = [
      { entityType: "item", entityId: "a", title: "Budget review", snippet: "budget", rank: 1 },
      { entityType: "item", entityId: "b", title: "Report draft", snippet: "report", rank: 2 },
    ];
    const vector: RankedResult[] = [
      { entityType: "item", entityId: "a", title: "Budget review", snippet: "budget", rank: 1 },
      { entityType: "item", entityId: "c", title: "Financial plan", snippet: "finance", rank: 2 },
    ];

    const fused = fuseResults(keyword, vector, 10);
    // "a" appears in both lists → highest RRF score
    expect(fused[0].entityId).toBe("a");
    expect(fused[0].matchType).toBe("both");
    expect(fused).toHaveLength(3);
  });

  it("assigns correct matchType", () => {
    const keyword: RankedResult[] = [
      { entityType: "item", entityId: "a", title: "A", snippet: "", rank: 1 },
    ];
    const vector: RankedResult[] = [
      { entityType: "item", entityId: "b", title: "B", snippet: "", rank: 1 },
    ];

    const fused = fuseResults(keyword, vector, 10);
    const a = fused.find((r) => r.entityId === "a");
    const b = fused.find((r) => r.entityId === "b");
    expect(a?.matchType).toBe("keyword");
    expect(b?.matchType).toBe("semantic");
  });

  it("respects limit", () => {
    const keyword: RankedResult[] = Array.from({ length: 20 }, (_, i) => ({
      entityType: "item" as const, entityId: `k${i}`, title: `K${i}`, snippet: "", rank: i + 1,
    }));
    const vector: RankedResult[] = Array.from({ length: 20 }, (_, i) => ({
      entityType: "item" as const, entityId: `v${i}`, title: `V${i}`, snippet: "", rank: i + 1,
    }));

    const fused = fuseResults(keyword, vector, 5);
    expect(fused).toHaveLength(5);
  });

  it("handles empty keyword list", () => {
    const vector: RankedResult[] = [
      { entityType: "item", entityId: "a", title: "A", snippet: "", rank: 1 },
    ];
    const fused = fuseResults([], vector, 10);
    expect(fused).toHaveLength(1);
    expect(fused[0].matchType).toBe("semantic");
  });

  it("handles empty vector list", () => {
    const keyword: RankedResult[] = [
      { entityType: "item", entityId: "a", title: "A", snippet: "", rank: 1 },
    ];
    const fused = fuseResults(keyword, [], 10);
    expect(fused).toHaveLength(1);
    expect(fused[0].matchType).toBe("keyword");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/brentbarkman/code/brett && pnpm --filter @brett/ai test -- src/__tests__/search.test.ts
```

- [ ] **Step 3: Build hybrid search module**

Create `packages/ai/src/embedding/search.ts`:

```typescript
import type { PrismaClient } from "@prisma/client";
import type { EmbeddingProvider } from "../providers/types.js";
import { AI_CONFIG } from "../config.js";

export interface RankedResult {
  entityType: string;
  entityId: string;
  title: string;
  snippet: string;
  rank: number;
}

export interface SearchResult {
  entityType: string;
  entityId: string;
  title: string;
  snippet: string;
  score: number;
  matchType: "keyword" | "semantic" | "both";
  metadata: Record<string, unknown>;
}

const RRF_K = 60; // standard RRF constant

/**
 * Reciprocal Rank Fusion: merges keyword and vector ranked lists.
 * Score = sum of 1/(k + rank) across lists where the result appears.
 */
export function fuseResults(
  keywordResults: RankedResult[],
  vectorResults: RankedResult[],
  limit: number,
): SearchResult[] {
  const scores = new Map<string, { result: RankedResult; score: number; inKeyword: boolean; inVector: boolean }>();

  for (const r of keywordResults) {
    const key = `${r.entityType}:${r.entityId}`;
    const existing = scores.get(key);
    if (existing) {
      existing.score += 1 / (RRF_K + r.rank);
      existing.inKeyword = true;
    } else {
      scores.set(key, { result: r, score: 1 / (RRF_K + r.rank), inKeyword: true, inVector: false });
    }
  }

  for (const r of vectorResults) {
    const key = `${r.entityType}:${r.entityId}`;
    const existing = scores.get(key);
    if (existing) {
      existing.score += 1 / (RRF_K + r.rank);
      existing.inVector = true;
    } else {
      scores.set(key, { result: r, score: 1 / (RRF_K + r.rank), inKeyword: false, inVector: true });
    }
  }

  return [...scores.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => ({
      entityType: entry.result.entityType,
      entityId: entry.result.entityId,
      title: entry.result.title,
      snippet: entry.result.snippet,
      score: entry.score,
      matchType: entry.inKeyword && entry.inVector ? "both" : entry.inKeyword ? "keyword" : "semantic",
      metadata: {},
    }));
}

/**
 * Run keyword search across items, events, meetings, findings.
 * Returns ranked results.
 */
export async function keywordSearch(
  userId: string,
  query: string,
  types: string[] | null,
  prisma: PrismaClient,
  limit: number = 30,
): Promise<RankedResult[]> {
  const results: RankedResult[] = [];
  const ilike = `%${query}%`;

  if (!types || types.includes("item")) {
    const items = await prisma.item.findMany({
      where: {
        userId,
        OR: [
          { title: { contains: query, mode: "insensitive" } },
          { notes: { contains: query, mode: "insensitive" } },
          { contentTitle: { contains: query, mode: "insensitive" } },
          { description: { contains: query, mode: "insensitive" } },
        ],
      },
      select: { id: true, title: true, status: true, type: true, dueDate: true, contentType: true, list: { select: { name: true } } },
      take: limit,
      orderBy: { updatedAt: "desc" },
    });
    items.forEach((item, i) => {
      results.push({
        entityType: "item",
        entityId: item.id,
        title: item.title,
        snippet: item.title,
        rank: i + 1,
      });
    });
  }

  if (!types || types.includes("calendar_event")) {
    const events = await prisma.calendarEvent.findMany({
      where: {
        userId,
        OR: [
          { title: { contains: query, mode: "insensitive" } },
          { description: { contains: query, mode: "insensitive" } },
        ],
      },
      select: { id: true, title: true, startTime: true },
      take: limit,
      orderBy: { startTime: "desc" },
    });
    events.forEach((event, i) => {
      results.push({
        entityType: "calendar_event",
        entityId: event.id,
        title: event.title,
        snippet: event.title,
        rank: i + 1,
      });
    });
  }

  if (!types || types.includes("meeting_note")) {
    const notes = await prisma.meetingNote.findMany({
      where: {
        userId,
        OR: [
          { title: { contains: query, mode: "insensitive" } },
          { summary: { contains: query, mode: "insensitive" } },
        ],
      },
      select: { id: true, title: true },
      take: limit,
      orderBy: { meetingStartedAt: "desc" },
    });
    notes.forEach((note, i) => {
      results.push({
        entityType: "meeting_note",
        entityId: note.id,
        title: note.title,
        snippet: note.title,
        rank: i + 1,
      });
    });
  }

  if (!types || types.includes("scout_finding")) {
    const findings = await prisma.scoutFinding.findMany({
      where: {
        scout: { userId },
        OR: [
          { title: { contains: query, mode: "insensitive" } },
          { description: { contains: query, mode: "insensitive" } },
        ],
      },
      select: { id: true, title: true, scout: { select: { name: true } } },
      take: limit,
      orderBy: { createdAt: "desc" },
    });
    findings.forEach((f, i) => {
      results.push({
        entityType: "scout_finding",
        entityId: f.id,
        title: f.title,
        snippet: f.title,
        rank: i + 1,
      });
    });
  }

  return results;
}

/**
 * Run vector search across all embedded entities.
 * Returns ranked results.
 */
export async function vectorSearch(
  userId: string,
  query: string,
  types: string[] | null,
  provider: EmbeddingProvider,
  prisma: PrismaClient,
  limit: number = 30,
): Promise<RankedResult[]> {
  const queryVector = await provider.embed(query, "query");
  if (!Array.isArray(queryVector) || queryVector.length !== AI_CONFIG.embedding.dimensions) return [];

  const vectorStr = `[${queryVector.join(",")}]`;

  // Build entity type filter
  const typeFilter = types && types.length > 0
    ? `AND "entityType" IN (${types.map((t) => `'${t}'`).join(",")})`
    : "";

  const results = await prisma.$queryRawUnsafe<
    Array<{ entityType: string; entityId: string; chunkText: string; similarity: number }>
  >(
    `SELECT "entityType", "entityId", "chunkText", 1 - (embedding <=> '${vectorStr}'::vector) as similarity
     FROM "Embedding"
     WHERE "userId" = $1 ${typeFilter}
     ORDER BY embedding <=> '${vectorStr}'::vector
     LIMIT $2`,
    userId,
    limit,
  );

  // Deduplicate by entityId (keep highest similarity chunk per entity)
  const seen = new Map<string, (typeof results)[0]>();
  for (const r of results) {
    const key = `${r.entityType}:${r.entityId}`;
    const existing = seen.get(key);
    if (!existing || r.similarity > existing.similarity) {
      seen.set(key, r);
    }
  }

  const deduped = [...seen.values()].sort((a, b) => b.similarity - a.similarity);

  return deduped.map((r, i) => ({
    entityType: r.entityType,
    entityId: r.entityId,
    title: "", // Will be enriched by the search endpoint
    snippet: r.chunkText.slice(0, 200),
    rank: i + 1,
  }));
}

/**
 * Full hybrid search: keyword + vector + RRF fusion.
 */
export async function hybridSearch(
  userId: string,
  query: string,
  types: string[] | null,
  provider: EmbeddingProvider | null,
  prisma: PrismaClient,
  limit: number = AI_CONFIG.embedding.searchResultLimit,
): Promise<SearchResult[]> {
  // Run keyword and vector search in parallel
  const [keywordResults, vectorResults] = await Promise.all([
    keywordSearch(userId, query, types, prisma, 30),
    provider ? vectorSearch(userId, query, types, provider, prisma, 30) : Promise.resolve([]),
  ]);

  return fuseResults(keywordResults, vectorResults, limit);
}
```

- [ ] **Step 4: Run tests**

```bash
cd /Users/brentbarkman/code/brett && pnpm --filter @brett/ai test -- src/__tests__/search.test.ts
```

Expected: ALL PASS

- [ ] **Step 5: Export from index**

Add to `packages/ai/src/index.ts`:

```typescript
export { hybridSearch, keywordSearch, vectorSearch, fuseResults, type SearchResult, type RankedResult } from "./embedding/search.js";
```

- [ ] **Step 6: Commit**

```bash
git add packages/ai/src/embedding/search.ts packages/ai/src/__tests__/search.test.ts packages/ai/src/index.ts
git commit -m "feat(ai): add hybrid search with keyword + vector + reciprocal rank fusion"
```

---

## Task 8: Similarity Queries (Auto-Link, Dedup, Related Items, List Centroids)

**Files:**
- Create: `packages/ai/src/embedding/similarity.ts`
- Create: `packages/ai/src/__tests__/similarity.test.ts`

- [ ] **Step 1: Write tests for threshold logic**

Create `packages/ai/src/__tests__/similarity.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { classifyMatches, type SimilarityMatch, type ClassifiedMatches } from "../embedding/similarity.js";
import { AI_CONFIG } from "../config.js";

describe("classifyMatches", () => {
  it("classifies auto-link matches above autoLinkThreshold", () => {
    const matches: SimilarityMatch[] = [
      { entityId: "a", similarity: 0.95 },
      { entityId: "b", similarity: 0.80 },
      { entityId: "c", similarity: 0.60 },
    ];
    const result = classifyMatches(matches);
    expect(result.autoLinks.map((m) => m.entityId)).toEqual(["a"]);
    expect(result.suggestions.map((m) => m.entityId)).toEqual(["b"]);
    expect(result.autoLinks[0].similarity).toBe(0.95);
  });

  it("classifies suggestions between suggest and autoLink thresholds", () => {
    const matches: SimilarityMatch[] = [
      { entityId: "a", similarity: 0.82 },
    ];
    const result = classifyMatches(matches);
    expect(result.autoLinks).toHaveLength(0);
    expect(result.suggestions).toHaveLength(1);
  });

  it("discards matches below suggestThreshold", () => {
    const matches: SimilarityMatch[] = [
      { entityId: "a", similarity: 0.50 },
    ];
    const result = classifyMatches(matches);
    expect(result.autoLinks).toHaveLength(0);
    expect(result.suggestions).toHaveLength(0);
  });

  it("handles empty input", () => {
    const result = classifyMatches([]);
    expect(result.autoLinks).toHaveLength(0);
    expect(result.suggestions).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/brentbarkman/code/brett && pnpm --filter @brett/ai test -- src/__tests__/similarity.test.ts
```

- [ ] **Step 3: Build similarity module**

Create `packages/ai/src/embedding/similarity.ts`:

```typescript
import type { PrismaClient } from "@prisma/client";
import type { EmbeddingProvider } from "../providers/types.js";
import { AI_CONFIG } from "../config.js";

export interface SimilarityMatch {
  entityId: string;
  similarity: number;
}

export interface ClassifiedMatches {
  autoLinks: SimilarityMatch[];
  suggestions: SimilarityMatch[];
}

/**
 * Classify similarity matches into auto-links and suggestions based on thresholds.
 */
export function classifyMatches(matches: SimilarityMatch[]): ClassifiedMatches {
  const autoLinks: SimilarityMatch[] = [];
  const suggestions: SimilarityMatch[] = [];

  for (const match of matches) {
    if (match.similarity >= AI_CONFIG.embedding.autoLinkThreshold) {
      autoLinks.push(match);
    } else if (match.similarity >= AI_CONFIG.embedding.suggestThreshold) {
      suggestions.push(match);
    }
  }

  return { autoLinks, suggestions };
}

/**
 * Find similar items for a given entity. Used for auto-linking, suggestions, and related items.
 */
export async function findSimilarItems(
  userId: string,
  entityType: string,
  entityId: string,
  provider: EmbeddingProvider,
  prisma: PrismaClient,
  options?: { targetEntityType?: string; limit?: number; excludeIds?: string[] },
): Promise<SimilarityMatch[]> {
  // Load the entity's embedding (chunk 0 — the primary chunk)
  const sourceEmbedding = await prisma.$queryRaw<Array<{ embedding: string }>>`
    SELECT embedding::text FROM "Embedding"
    WHERE "entityType" = ${entityType} AND "entityId" = ${entityId} AND "chunkIndex" = 0
    LIMIT 1
  `;

  if (!sourceEmbedding.length) return [];

  const vectorStr = sourceEmbedding[0].embedding;
  const targetType = options?.targetEntityType ?? "item";
  const limit = options?.limit ?? 10;
  const excludeIds = options?.excludeIds ?? [entityId];
  const excludeList = excludeIds.map((id) => `'${id}'`).join(",");

  const results = await prisma.$queryRawUnsafe<Array<{ entityId: string; similarity: number }>>(
    `SELECT "entityId", 1 - (embedding <=> '${vectorStr}'::vector) as similarity
     FROM "Embedding"
     WHERE "userId" = $1
       AND "entityType" = $2
       AND "entityId" NOT IN (${excludeList})
       AND "chunkIndex" = 0
     ORDER BY embedding <=> '${vectorStr}'::vector
     LIMIT $3`,
    userId,
    targetType,
    limit,
  );

  return results;
}

/**
 * Find duplicate candidates for a newly created item.
 */
export async function findDuplicates(
  userId: string,
  entityId: string,
  prisma: PrismaClient,
): Promise<SimilarityMatch[]> {
  const matches = await findSimilarItems(userId, "item", entityId, null as any, prisma, {
    targetEntityType: "item",
    limit: 5,
  });
  return matches.filter((m) => m.similarity >= AI_CONFIG.embedding.dupThreshold);
}

/**
 * Compute list centroid: average embedding of all active items in a list.
 * Returns the centroid as a vector string for comparison.
 */
export async function getListCentroid(
  listId: string,
  userId: string,
  prisma: PrismaClient,
): Promise<string | null> {
  const result = await prisma.$queryRaw<Array<{ centroid: string }>>`
    SELECT AVG(e.embedding)::text as centroid
    FROM "Embedding" e
    JOIN "Item" i ON e."entityId" = i.id
    WHERE e."entityType" = 'item'
      AND e."chunkIndex" = 0
      AND i."listId" = ${listId}
      AND i."userId" = ${userId}
      AND i.status = 'active'
  `;

  return result[0]?.centroid ?? null;
}

/**
 * Suggest lists for an item based on centroid similarity.
 */
export async function suggestLists(
  userId: string,
  entityId: string,
  prisma: PrismaClient,
): Promise<Array<{ listId: string; listName: string; similarity: number }>> {
  // Get item embedding
  const sourceEmbedding = await prisma.$queryRaw<Array<{ embedding: string }>>`
    SELECT embedding::text FROM "Embedding"
    WHERE "entityType" = 'item' AND "entityId" = ${entityId} AND "chunkIndex" = 0
    LIMIT 1
  `;
  if (!sourceEmbedding.length) return [];

  const vectorStr = sourceEmbedding[0].embedding;

  // Get all user's non-empty lists with centroids
  const lists = await prisma.list.findMany({
    where: { userId, archivedAt: null },
    select: { id: true, name: true },
  });

  const suggestions: Array<{ listId: string; listName: string; similarity: number }> = [];

  for (const list of lists) {
    const centroid = await getListCentroid(list.id, userId, prisma);
    if (!centroid) continue;

    const sim = await prisma.$queryRaw<Array<{ similarity: number }>>`
      SELECT 1 - ('${vectorStr}'::vector <=> '${centroid}'::vector) as similarity
    `;
    if (sim[0] && sim[0].similarity > 0.5) {
      suggestions.push({ listId: list.id, listName: list.name, similarity: sim[0].similarity });
    }
  }

  return suggestions.sort((a, b) => b.similarity - a.similarity).slice(0, 3);
}
```

- [ ] **Step 4: Run tests**

```bash
cd /Users/brentbarkman/code/brett && pnpm --filter @brett/ai test -- src/__tests__/similarity.test.ts
```

Expected: ALL PASS

- [ ] **Step 5: Export from index**

Add to `packages/ai/src/index.ts`:

```typescript
export { findSimilarItems, findDuplicates, classifyMatches, suggestLists, type SimilarityMatch, type ClassifiedMatches } from "./embedding/similarity.js";
```

- [ ] **Step 6: Commit**

```bash
git add packages/ai/src/embedding/similarity.ts packages/ai/src/__tests__/similarity.test.ts packages/ai/src/index.ts
git commit -m "feat(ai): add similarity queries — auto-link classification, dedup, list centroids"
```

---

## Task 9: Wire Embedding Triggers into API Routes

**Files:**
- Modify: `apps/api/src/routes/things.ts`
- Modify: `apps/api/src/lib/content-extractor.ts`
- Modify: `apps/api/src/lib/ai-stream.ts`
- Modify: `apps/api/src/app.ts` (import and initialize embedding pipeline)

- [ ] **Step 1: Initialize embedding pipeline at app startup**

In `apps/api/src/app.ts`, add the embedding pipeline initialization. Near the top imports add:

```typescript
import { setEmbedProcessor, enqueueEmbed } from "@brett/ai";
import { embedEntity } from "@brett/ai";
import { getEmbeddingProvider } from "./lib/embedding-provider.js";
```

After the app is created, add initialization:

```typescript
// Initialize embedding pipeline
const embeddingProvider = getEmbeddingProvider();
if (embeddingProvider) {
  setEmbedProcessor(async (job) => {
    await embedEntity({
      entityType: job.entityType,
      entityId: job.entityId,
      userId: job.userId,
      provider: embeddingProvider,
      prisma,
    });
  });
}
```

- [ ] **Step 2: Add embedding trigger to item creation (POST /things)**

In `apps/api/src/routes/things.ts`, after the item is created (after `prisma.item.create()`), add:

```typescript
// Trigger embedding (fire-and-forget)
enqueueEmbed({ entityType: "item", entityId: item.id, userId: user.id });
```

Import `enqueueEmbed` from `@brett/ai` at the top.

- [ ] **Step 3: Add embedding trigger to item update (PATCH /things/:id)**

In the PATCH handler, after `prisma.item.update()`, check if embeddable fields changed and re-embed:

```typescript
// Re-embed if text fields changed
if (data.title !== undefined || data.description !== undefined || data.notes !== undefined) {
  enqueueEmbed({ entityType: "item", entityId: id, userId: user.id });
}
```

- [ ] **Step 4: Add embedding trigger after content extraction**

In `apps/api/src/lib/content-extractor.ts`, in the `runExtraction()` function, after the item is updated with extracted content (around line 370), add:

```typescript
// Re-embed with extracted content
enqueueEmbed({ entityType: "item", entityId: itemId, userId });
```

Import `enqueueEmbed` from `@brett/ai` at the top.

- [ ] **Step 5: Add embedding trigger to item deletion**

In `apps/api/src/routes/things.ts`, in the DELETE handler, replace the item delete with a transaction:

```typescript
import { deleteEmbeddings } from "@brett/ai";

// Delete with embedding cleanup
await prisma.$transaction(async (tx) => {
  await deleteEmbeddings("item", id, tx as any);
  await tx.item.delete({ where: { id, userId: user.id } });
});
```

- [ ] **Step 6: Update conversation embedding in ai-stream.ts**

In `apps/api/src/lib/ai-stream.ts`, replace the existing `embedConversation()` call (if any) with:

```typescript
// Embed conversation (uses server key, not user key)
enqueueEmbed({ entityType: "conversation", entityId: session.id, userId: user.id });
```

- [ ] **Step 7: Typecheck**

```bash
cd /Users/brentbarkman/code/brett && pnpm typecheck
```

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/routes/things.ts apps/api/src/lib/content-extractor.ts apps/api/src/lib/ai-stream.ts apps/api/src/app.ts
git commit -m "feat(api): wire embedding triggers into item CRUD, content extraction, and conversations"
```

---

## Task 10: Search API Endpoint + Omnibar/Spotlight Integration

**Files:**
- Create: `apps/api/src/routes/search.ts`
- Modify: `apps/api/src/app.ts` (mount route)
- Modify: `apps/desktop/src/api/omnibar.ts`
- Modify: `packages/ui/src/Omnibar.tsx`
- Modify: `packages/ui/src/SpotlightModal.tsx`

- [ ] **Step 1: Build search API route**

Create `apps/api/src/routes/search.ts`:

```typescript
import { Hono } from "hono";
import { authMiddleware, type AuthEnv } from "../middleware/auth.js";
import { hybridSearch } from "@brett/ai";
import { getEmbeddingProvider } from "../lib/embedding-provider.js";
import { prisma } from "../lib/prisma.js";

const router = new Hono<AuthEnv>();

router.get("/search", authMiddleware, async (c) => {
  const user = c.get("user");
  const query = c.req.query("q");
  if (!query || query.trim().length < 2) {
    return c.json({ results: [] });
  }

  const typesParam = c.req.query("types");
  const types = typesParam ? typesParam.split(",") : null;
  const limit = Math.min(parseInt(c.req.query("limit") ?? "20"), 50);
  const listId = c.req.query("listId");

  const provider = getEmbeddingProvider();
  const results = await hybridSearch(user.id, query.trim(), types, provider, prisma, limit);

  // Enrich results with entity metadata
  const enriched = await enrichSearchResults(results, user.id, prisma);

  return c.json({ results: enriched });
});

async function enrichSearchResults(
  results: Array<{ entityType: string; entityId: string; title: string; snippet: string; score: number; matchType: string; metadata: Record<string, unknown> }>,
  userId: string,
  prisma: any,
) {
  const itemIds = results.filter((r) => r.entityType === "item").map((r) => r.entityId);
  const eventIds = results.filter((r) => r.entityType === "calendar_event").map((r) => r.entityId);
  const noteIds = results.filter((r) => r.entityType === "meeting_note").map((r) => r.entityId);
  const findingIds = results.filter((r) => r.entityType === "scout_finding").map((r) => r.entityId);

  const [items, events, notes, findings] = await Promise.all([
    itemIds.length ? prisma.item.findMany({
      where: { id: { in: itemIds }, userId },
      select: { id: true, title: true, status: true, type: true, dueDate: true, contentType: true, list: { select: { name: true } } },
    }) : [],
    eventIds.length ? prisma.calendarEvent.findMany({
      where: { id: { in: eventIds }, userId },
      select: { id: true, title: true, startTime: true },
    }) : [],
    noteIds.length ? prisma.meetingNote.findMany({
      where: { id: { in: noteIds }, userId },
      select: { id: true, title: true, meetingStartedAt: true },
    }) : [],
    findingIds.length ? prisma.scoutFinding.findMany({
      where: { id: { in: findingIds } },
      include: { scout: { select: { name: true, userId: true } } },
    }).then((fs: any[]) => fs.filter((f: any) => f.scout.userId === userId)) : [],
  ]);

  const entityMap = new Map<string, any>();
  for (const item of items) entityMap.set(`item:${item.id}`, { title: item.title, status: item.status, type: item.type, dueDate: item.dueDate, contentType: item.contentType, listName: item.list?.name });
  for (const event of events) entityMap.set(`calendar_event:${event.id}`, { title: event.title, startTime: event.startTime });
  for (const note of notes) entityMap.set(`meeting_note:${note.id}`, { title: note.title, meetingDate: note.meetingStartedAt });
  for (const finding of findings) entityMap.set(`scout_finding:${finding.id}`, { title: finding.title, scoutName: finding.scout.name });

  return results.map((r) => {
    const entity = entityMap.get(`${r.entityType}:${r.entityId}`);
    return {
      ...r,
      title: entity?.title ?? r.title,
      metadata: entity ?? r.metadata,
    };
  }).filter((r) => r.metadata && Object.keys(r.metadata).length > 0); // Filter out deleted entities
}

export default router;
```

- [ ] **Step 2: Mount route in app.ts**

In `apps/api/src/app.ts`, add:

```typescript
import searchRouter from "./routes/search.js";

// Mount alongside existing routes
app.route("/api", searchRouter);
```

- [ ] **Step 3: Update desktop search hook**

In `apps/desktop/src/api/omnibar.ts`, update the `searchThings` function to call the new endpoint:

```typescript
async function searchThings(query: string) {
  setIsSearching(true);
  try {
    const response = await apiFetch<{ results: SearchResult[] }>(`/search?q=${encodeURIComponent(query)}`);
    setSearchResults(response.results);
  } catch {
    setSearchResults([]);
  } finally {
    setIsSearching(false);
  }
}
```

Add the `SearchResult` type at the top of the file:

```typescript
export interface SearchResult {
  entityType: "item" | "calendar_event" | "meeting_note" | "scout_finding";
  entityId: string;
  title: string;
  snippet: string;
  score: number;
  matchType: "keyword" | "semantic" | "both";
  metadata: Record<string, unknown>;
}
```

- [ ] **Step 4: Update Omnibar.tsx to render multi-type results**

In `packages/ui/src/Omnibar.tsx`, update the search results rendering (around lines 443-483) to handle different entity types. Each result gets a type-specific icon and subtitle. Keep the same visual structure, just add type indicators.

In `packages/ui/src/SpotlightModal.tsx`, apply the same changes (per CLAUDE.md: keep Omnibar and Spotlight in sync).

- [ ] **Step 5: Typecheck and test**

```bash
cd /Users/brentbarkman/code/brett && pnpm typecheck
```

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/search.ts apps/api/src/app.ts apps/desktop/src/api/omnibar.ts packages/ui/src/Omnibar.tsx packages/ui/src/SpotlightModal.tsx
git commit -m "feat: add hybrid search endpoint and update Omnibar/Spotlight for multi-type results"
```

---

## Task 11: Auto-Linking + Suggestions API + Detail Panel UI

**Files:**
- Create: `apps/api/src/routes/suggestions.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/routes/links.ts`
- Modify: `packages/ui/src/LinkedItemsList.tsx`
- Modify: `packages/ui/src/TaskDetailPanel.tsx`
- Modify: `packages/ui/src/ContentDetailPanel.tsx`

- [ ] **Step 1: Add source field handling to link creation**

In `apps/api/src/routes/links.ts`, update the POST handler to accept and store the `source` field:

```typescript
const link = await prisma.itemLink.create({
  data: {
    fromItemId: itemId,
    toItemId: data.toItemId,
    toItemType: data.toItemType,
    source: data.source ?? "manual",
    userId: user.id,
  },
});
```

- [ ] **Step 2: Build suggestions route**

Create `apps/api/src/routes/suggestions.ts`:

```typescript
import { Hono } from "hono";
import { authMiddleware, type AuthEnv } from "../middleware/auth.js";
import { findSimilarItems, classifyMatches, suggestLists } from "@brett/ai";
import { getEmbeddingProvider } from "../lib/embedding-provider.js";
import { prisma } from "../lib/prisma.js";

const router = new Hono<AuthEnv>();

// Related item suggestions for an item
router.get("/things/:id/suggestions", authMiddleware, async (c) => {
  const user = c.get("user");
  const itemId = c.req.param("id");
  const provider = getEmbeddingProvider();
  if (!provider) return c.json({ suggestions: [] });

  // Get already-linked item IDs to exclude
  const existingLinks = await prisma.itemLink.findMany({
    where: { OR: [{ fromItemId: itemId }, { toItemId: itemId }] },
    select: { fromItemId: true, toItemId: true },
  });
  const linkedIds = new Set<string>();
  existingLinks.forEach((l) => { linkedIds.add(l.fromItemId); linkedIds.add(l.toItemId); });
  linkedIds.delete(itemId);

  const matches = await findSimilarItems(user.id, "item", itemId, provider, prisma, {
    targetEntityType: "item",
    limit: 10,
    excludeIds: [itemId, ...linkedIds],
  });

  const { suggestions } = classifyMatches(matches);

  // Enrich with item details
  const itemIds = suggestions.map((s) => s.entityId);
  const items = itemIds.length ? await prisma.item.findMany({
    where: { id: { in: itemIds }, userId: user.id },
    select: { id: true, title: true, type: true, status: true },
  }) : [];
  const itemMap = new Map(items.map((i) => [i.id, i]));

  return c.json({
    suggestions: suggestions
      .map((s) => ({ ...s, ...(itemMap.get(s.entityId) ?? {}) }))
      .filter((s) => s.title),
  });
});

// List assignment suggestions
router.get("/things/:id/list-suggestions", authMiddleware, async (c) => {
  const user = c.get("user");
  const itemId = c.req.param("id");

  const results = await suggestLists(user.id, itemId, prisma);
  return c.json({ suggestions: results });
});

// Related items for a calendar event
router.get("/events/:id/related-items", authMiddleware, async (c) => {
  const user = c.get("user");
  const eventId = c.req.param("id");
  const provider = getEmbeddingProvider();
  if (!provider) return c.json({ relatedItems: [] });

  const matches = await findSimilarItems(user.id, "calendar_event", eventId, provider, prisma, {
    targetEntityType: "item",
    limit: 5,
  });

  const filtered = matches.filter((m) => m.similarity >= 0.70);
  const itemIds = filtered.map((m) => m.entityId);
  const items = itemIds.length ? await prisma.item.findMany({
    where: { id: { in: itemIds }, userId: user.id },
    select: { id: true, title: true, type: true, status: true, dueDate: true },
  }) : [];
  const itemMap = new Map(items.map((i) => [i.id, i]));

  return c.json({
    relatedItems: filtered
      .map((m) => ({ ...m, ...(itemMap.get(m.entityId) ?? {}) }))
      .filter((r) => r.title),
  });
});

// Meeting history for recurring events
router.get("/events/:id/meeting-history", authMiddleware, async (c) => {
  const user = c.get("user");
  const eventId = c.req.param("id");

  const event = await prisma.calendarEvent.findFirst({
    where: { id: eventId, userId: user.id },
    select: { recurringEventId: true, title: true },
  });
  if (!event?.recurringEventId) return c.json({ pastOccurrences: [], relatedItems: [] });

  // Find past occurrences of same recurring event
  const pastEvents = await prisma.calendarEvent.findMany({
    where: {
      userId: user.id,
      recurringEventId: event.recurringEventId,
      id: { not: eventId },
      startTime: { lt: new Date() },
    },
    orderBy: { startTime: "desc" },
    take: 10,
    select: {
      id: true,
      startTime: true,
      notes: { where: { userId: user.id }, take: 1 },
    },
  });

  // Find meeting notes linked to past events
  const pastOccurrences = await Promise.all(
    pastEvents.map(async (pe) => {
      const meetingNote = await prisma.meetingNote.findFirst({
        where: { calendarEventId: pe.id, userId: user.id },
        select: { title: true, summary: true },
      });

      // Find items linked from action items of that meeting
      const actionItems = meetingNote
        ? await prisma.item.findMany({
            where: { meetingNoteId: meetingNote ? undefined : undefined, userId: user.id },
            select: { id: true, title: true, status: true, completedAt: true },
            take: 10,
          })
        : [];

      return {
        eventId: pe.id,
        date: pe.startTime.toISOString(),
        meetingNote: meetingNote ? { title: meetingNote.title, summary: meetingNote.summary } : undefined,
        actionItems,
      };
    }),
  );

  // Semantically related items (via embeddings)
  const provider = getEmbeddingProvider();
  let relatedItems: any[] = [];
  if (provider) {
    const matches = await findSimilarItems(user.id, "calendar_event", eventId, provider, prisma, {
      targetEntityType: "item",
      limit: 5,
    });
    const filtered = matches.filter((m) => m.similarity >= 0.70);
    const itemIds = filtered.map((m) => m.entityId);
    const items = itemIds.length
      ? await prisma.item.findMany({
          where: { id: { in: itemIds }, userId: user.id },
          select: { id: true, title: true, type: true, status: true },
        })
      : [];
    const itemMap = new Map(items.map((i) => [i.id, i]));
    relatedItems = filtered.map((m) => ({ ...m, ...(itemMap.get(m.entityId) ?? {}) })).filter((r) => r.title);
  }

  return c.json({
    recurringEventId: event.recurringEventId,
    pastOccurrences,
    relatedItems,
  });
});

export default router;
```

- [ ] **Step 3: Mount route in app.ts**

```typescript
import suggestionsRouter from "./routes/suggestions.js";
app.route("/api", suggestionsRouter);
```

- [ ] **Step 4: Add auto-link creation in embedding pipeline post-hook**

In `packages/ai/src/embedding/pipeline.ts`, add a post-embed hook at the end of `embedEntity()`:

```typescript
// Post-embed hook: auto-link detection for items
if (entityType === "item") {
  try {
    const matches = await findSimilarItemsFromEmbedding(entityId, userId, prisma);
    const { autoLinks } = classifyMatches(matches);

    for (const match of autoLinks) {
      // Check if link already exists in either direction
      const existing = await prisma.itemLink.findFirst({
        where: {
          OR: [
            { fromItemId: entityId, toItemId: match.entityId },
            { fromItemId: match.entityId, toItemId: entityId },
          ],
        },
      });
      if (!existing) {
        const targetItem = await prisma.item.findFirst({
          where: { id: match.entityId, userId },
          select: { type: true },
        });
        if (targetItem) {
          await prisma.itemLink.create({
            data: {
              fromItemId: entityId,
              toItemId: match.entityId,
              toItemType: targetItem.type,
              source: "embedding",
              userId,
            },
          });
        }
      }
    }
  } catch (err) {
    console.error("[embedding] Auto-link failed:", err);
  }
}
```

Add the helper function to query similar items from the stored embedding:

```typescript
async function findSimilarItemsFromEmbedding(
  entityId: string,
  userId: string,
  prisma: PrismaClient,
): Promise<SimilarityMatch[]> {
  const results = await prisma.$queryRaw<Array<{ entityId: string; similarity: number }>>`
    SELECT e2."entityId", 1 - (e1.embedding <=> e2.embedding) as similarity
    FROM "Embedding" e1
    JOIN "Embedding" e2
      ON e2."userId" = ${userId}
      AND e2."entityType" = 'item'
      AND e2."entityId" != ${entityId}
      AND e2."chunkIndex" = 0
    WHERE e1."entityType" = 'item'
      AND e1."entityId" = ${entityId}
      AND e1."chunkIndex" = 0
    ORDER BY e1.embedding <=> e2.embedding
    LIMIT 10
  `;
  return results;
}
```

Import `classifyMatches` and `SimilarityMatch` at the top.

- [ ] **Step 5: Update LinkedItemsList.tsx**

In `packages/ui/src/LinkedItemsList.tsx`, add a "Suggested" section below the existing linked items. Auto-links show a subtle "Brett linked" label. Suggestions show a "+" button to promote.

- [ ] **Step 6: Update TaskDetailPanel.tsx and ContentDetailPanel.tsx**

Pass the new suggestions props to `LinkedItemsList`.

- [ ] **Step 7: Typecheck**

```bash
cd /Users/brentbarkman/code/brett && pnpm typecheck
```

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/routes/suggestions.ts apps/api/src/routes/links.ts apps/api/src/app.ts packages/ai/src/embedding/pipeline.ts packages/ai/src/embedding/similarity.ts packages/ui/src/LinkedItemsList.tsx packages/ui/src/TaskDetailPanel.tsx packages/ui/src/ContentDetailPanel.tsx
git commit -m "feat: add auto-linking, suggestions API, and related items for calendar events"
```

---

## Task 12: Duplicate Detection in Item Creation

**Files:**
- Modify: `apps/api/src/routes/things.ts`

- [ ] **Step 1: Add duplicate detection after item creation**

In `apps/api/src/routes/things.ts`, in the POST handler, after the item is created and the embedding is enqueued, add duplicate detection. Since embedding is async, we need to embed synchronously for dedup:

```typescript
import { getEmbeddingProvider } from "../lib/embedding-provider.js";
import { assembleItemText, assembleContentText } from "@brett/ai";

// After item creation...
let duplicateCandidates: Array<{ id: string; title: string; similarity: number }> | undefined;

const embProvider = getEmbeddingProvider();
if (embProvider) {
  try {
    // Assemble and embed inline for immediate dedup check
    const chunks = item.type === "content"
      ? assembleContentText({ title: item.title, contentType: item.contentType, contentTitle: item.contentTitle, contentDescription: item.contentDescription, contentBody: null, type: item.type })
      : assembleItemText({ title: item.title, description: item.description ?? null, notes: null, type: item.type });

    if (chunks.length > 0) {
      const vector = await embProvider.embed(chunks[0], "document");
      const vectorStr = `[${vector.join(",")}]`;

      // Store the embedding immediately (so it's available for future dedup)
      await prisma.$executeRaw`
        INSERT INTO "Embedding" (id, "userId", "entityType", "entityId", "chunkIndex", "chunkText", embedding, "createdAt", "updatedAt")
        VALUES (gen_random_uuid(), ${user.id}, 'item', ${item.id}, 0, ${chunks[0]}, ${vectorStr}::vector, NOW(), NOW())
        ON CONFLICT ("entityType", "entityId", "chunkIndex")
        DO UPDATE SET "chunkText" = ${chunks[0]}, embedding = ${vectorStr}::vector, "updatedAt" = NOW()
      `;

      // Search for duplicates
      const dupes = await prisma.$queryRaw<Array<{ entityId: string; similarity: number }>>`
        SELECT "entityId", 1 - (embedding <=> ${vectorStr}::vector) as similarity
        FROM "Embedding"
        WHERE "userId" = ${user.id}
          AND "entityType" = 'item'
          AND "entityId" != ${item.id}
          AND "chunkIndex" = 0
        ORDER BY embedding <=> ${vectorStr}::vector
        LIMIT 5
      `;

      const candidates = dupes.filter((d) => d.similarity >= 0.85);
      if (candidates.length > 0) {
        const candidateItems = await prisma.item.findMany({
          where: { id: { in: candidates.map((c) => c.entityId) }, userId: user.id },
          select: { id: true, title: true },
        });
        const itemMap = new Map(candidateItems.map((i) => [i.id, i]));
        duplicateCandidates = candidates
          .map((c) => ({ id: c.entityId, title: itemMap.get(c.entityId)?.title ?? "", similarity: c.similarity }))
          .filter((c) => c.title);
      }
    }
  } catch (err) {
    console.error("[embedding] Dedup check failed:", err);
  }
}
```

Update the response to include `duplicateCandidates`:

```typescript
return c.json({ ...item, duplicateCandidates }, 201);
```

- [ ] **Step 2: Typecheck**

```bash
cd /Users/brentbarkman/code/brett && pnpm typecheck
```

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/routes/things.ts
git commit -m "feat(api): add duplicate detection on item creation via embedding similarity"
```

---

## Task 13: Calendar + Scout Embedding Triggers

**Files:**
- Modify: `apps/api/src/routes/calendar.ts` (or the calendar sync logic)
- Modify: `apps/api/src/lib/scout-runner.ts`
- Modify: `apps/api/src/routes/scouts.ts`

- [ ] **Step 1: Add embedding trigger to calendar event sync**

Find where calendar events are created/updated (the Google Calendar sync logic). After each event is upserted, add:

```typescript
enqueueEmbed({ entityType: "calendar_event", entityId: event.id, userId: user.id });
```

- [ ] **Step 2: Add embedding trigger to scout finding creation**

In `apps/api/src/lib/scout-runner.ts`, after the finding is created (around line 879), add:

```typescript
enqueueEmbed({ entityType: "scout_finding", entityId: scoutFinding.id, userId: scout.userId });
```

- [ ] **Step 3: Add semantic dedup to scout runner**

In `apps/api/src/lib/scout-runner.ts`, before storing findings (around line 835), add semantic dedup alongside existing URL dedup:

```typescript
import { getEmbeddingProvider } from "./embedding-provider.js";

// After URL dedup, add semantic dedup
const embProvider = getEmbeddingProvider();
if (embProvider && dedupedFindings.length > 0) {
  const semanticallyUnique: typeof dedupedFindings = [];

  for (const finding of dedupedFindings) {
    const text = `[Scout Finding] ${finding.title}\n${finding.description}`;
    const vector = await embProvider.embed(text, "document");
    const vectorStr = `[${vector.join(",")}]`;

    // Check against existing findings for this user (across all scouts)
    const dupes = await prisma.$queryRaw<Array<{ similarity: number }>>`
      SELECT 1 - (embedding <=> ${vectorStr}::vector) as similarity
      FROM "Embedding"
      WHERE "userId" = ${scout.userId}
        AND "entityType" = 'scout_finding'
      ORDER BY embedding <=> ${vectorStr}::vector
      LIMIT 1
    `;

    if (!dupes.length || dupes[0].similarity < 0.88) {
      semanticallyUnique.push(finding);
    }
  }

  dedupedFindings = semanticallyUnique;
}
```

- [ ] **Step 4: Add meeting note embedding trigger**

Find where meeting notes are created (Granola sync). After creation/update, add:

```typescript
enqueueEmbed({ entityType: "meeting_note", entityId: meetingNote.id, userId: user.id });
```

- [ ] **Step 5: Typecheck**

```bash
cd /Users/brentbarkman/code/brett && pnpm typecheck
```

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/calendar.ts apps/api/src/lib/scout-runner.ts
git commit -m "feat(api): add embedding triggers for calendar events, meeting notes, and scout findings with semantic dedup"
```

---

## Task 14: Calendar Event Detail + Meeting History UI

**Files:**
- Modify: `packages/ui/src/CalendarEventDetailPanel.tsx`
- Modify: `apps/desktop/src/api/things.ts` (add hooks for related items and meeting history)

- [ ] **Step 1: Add API hooks for related items and meeting history**

In `apps/desktop/src/api/things.ts` (or a new `apps/desktop/src/api/events.ts`), add:

```typescript
export function useRelatedItems(eventId: string | null) {
  return useQuery({
    queryKey: ["event-related-items", eventId],
    queryFn: () => apiFetch<{ relatedItems: Array<{ entityId: string; title: string; type: string; status: string; similarity: number }> }>(`/events/${eventId}/related-items`),
    enabled: !!eventId,
  });
}

export function useMeetingHistory(eventId: string | null) {
  return useQuery({
    queryKey: ["event-meeting-history", eventId],
    queryFn: () => apiFetch<{
      recurringEventId: string;
      pastOccurrences: Array<{
        eventId: string;
        date: string;
        meetingNote?: { title: string; summary: string };
        actionItems: Array<{ id: string; title: string; status: string }>;
      }>;
      relatedItems: Array<{ entityId: string; title: string; similarity: number }>;
    }>(`/events/${eventId}/meeting-history`),
    enabled: !!eventId,
  });
}
```

- [ ] **Step 2: Update CalendarEventDetailPanel.tsx**

Add "Related Tasks" and "Meeting History" sections to the event detail panel. The related tasks section shows embedding-based suggestions. The meeting history section shows past occurrences of recurring meetings with their notes and action items.

- [ ] **Step 3: Typecheck**

```bash
cd /Users/brentbarkman/code/brett && pnpm typecheck
```

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/CalendarEventDetailPanel.tsx apps/desktop/src/api/
git commit -m "feat(ui): add related tasks and meeting history to calendar event detail panel"
```

---

## Task 15: List Suggestions in Triage + Triage UI Update

**Files:**
- Modify: `packages/ui/src/TriagePopup.tsx`
- Modify: `apps/desktop/src/api/things.ts`

- [ ] **Step 1: Add list suggestions hook**

In `apps/desktop/src/api/things.ts`:

```typescript
export function useListSuggestions(itemId: string | null) {
  return useQuery({
    queryKey: ["list-suggestions", itemId],
    queryFn: () => apiFetch<{ suggestions: Array<{ listId: string; listName: string; similarity: number }> }>(`/things/${itemId}/list-suggestions`),
    enabled: !!itemId,
  });
}
```

- [ ] **Step 2: Update TriagePopup.tsx**

Add suggested lists display. Show the top 1-2 suggested lists with a subtle "Suggested" label above the regular list selection. The suggestions appear at the top of the list step, visually distinguished but using the same selection mechanism.

- [ ] **Step 3: Typecheck**

```bash
cd /Users/brentbarkman/code/brett && pnpm typecheck
```

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/TriagePopup.tsx apps/desktop/src/api/things.ts
git commit -m "feat(ui): add semantic list suggestions to triage popup"
```

---

## Task 16: Backfill Job

**Files:**
- Create: `apps/api/src/lib/embedding-backfill.ts`
- Create: `apps/api/src/routes/admin-embeddings.ts` (admin-only trigger)

- [ ] **Step 1: Build backfill job**

Create `apps/api/src/lib/embedding-backfill.ts`:

```typescript
import { prisma } from "./prisma.js";
import { getEmbeddingProvider } from "./embedding-provider.js";
import { embedEntity } from "@brett/ai";

export async function runEmbeddingBackfill(): Promise<{ processed: number; errors: number }> {
  const provider = getEmbeddingProvider();
  if (!provider) return { processed: 0, errors: 0 };

  let processed = 0;
  let errors = 0;

  // Find items without embeddings
  const items = await prisma.$queryRaw<Array<{ id: string; userId: string }>>`
    SELECT i.id, i."userId"
    FROM "Item" i
    LEFT JOIN "Embedding" e ON e."entityType" = 'item' AND e."entityId" = i.id
    WHERE e.id IS NULL
    LIMIT 500
  `;

  for (const item of items) {
    try {
      await embedEntity({ entityType: "item", entityId: item.id, userId: item.userId, provider, prisma });
      processed++;
    } catch (err) {
      errors++;
      console.error(`[backfill] Failed to embed item ${item.id}:`, err);
    }
    // Rate limit: ~10 per second
    await new Promise((r) => setTimeout(r, 100));
  }

  // Find events without embeddings
  const events = await prisma.$queryRaw<Array<{ id: string; userId: string }>>`
    SELECT ce.id, ce."userId"
    FROM "CalendarEvent" ce
    LEFT JOIN "Embedding" e ON e."entityType" = 'calendar_event' AND e."entityId" = ce.id
    WHERE e.id IS NULL
    LIMIT 500
  `;

  for (const event of events) {
    try {
      await embedEntity({ entityType: "calendar_event", entityId: event.id, userId: event.userId, provider, prisma });
      processed++;
    } catch (err) {
      errors++;
      console.error(`[backfill] Failed to embed event ${event.id}:`, err);
    }
    await new Promise((r) => setTimeout(r, 100));
  }

  // Find meeting notes without embeddings
  const notes = await prisma.$queryRaw<Array<{ id: string; userId: string }>>`
    SELECT mn.id, mn."userId"
    FROM "MeetingNote" mn
    LEFT JOIN "Embedding" e ON e."entityType" = 'meeting_note' AND e."entityId" = mn.id
    WHERE e.id IS NULL
    LIMIT 500
  `;

  for (const note of notes) {
    try {
      await embedEntity({ entityType: "meeting_note", entityId: note.id, userId: note.userId, provider, prisma });
      processed++;
    } catch (err) {
      errors++;
      console.error(`[backfill] Failed to embed meeting note ${note.id}:`, err);
    }
    await new Promise((r) => setTimeout(r, 100));
  }

  // Find scout findings without embeddings
  const findings = await prisma.$queryRaw<Array<{ id: string; usId: string }>>`
    SELECT sf.id, s."userId" as "usId"
    FROM "ScoutFinding" sf
    JOIN "Scout" s ON sf."scoutId" = s.id
    LEFT JOIN "Embedding" e ON e."entityType" = 'scout_finding' AND e."entityId" = sf.id
    WHERE e.id IS NULL
    LIMIT 500
  `;

  for (const finding of findings) {
    try {
      await embedEntity({ entityType: "scout_finding", entityId: finding.id, userId: finding.usId, provider, prisma });
      processed++;
    } catch (err) {
      errors++;
      console.error(`[backfill] Failed to embed finding ${finding.id}:`, err);
    }
    await new Promise((r) => setTimeout(r, 100));
  }

  console.log(`[backfill] Complete: ${processed} processed, ${errors} errors`);
  return { processed, errors };
}
```

- [ ] **Step 2: Add admin endpoint to trigger backfill**

Create `apps/api/src/routes/admin-embeddings.ts`:

```typescript
import { Hono } from "hono";
import { authMiddleware, type AuthEnv } from "../middleware/auth.js";
import { runEmbeddingBackfill } from "../lib/embedding-backfill.js";

const router = new Hono<AuthEnv>();

router.post("/admin/embeddings/backfill", authMiddleware, async (c) => {
  const user = c.get("user");
  if (user.role !== "admin") return c.json({ error: "Forbidden" }, 403);

  // Fire-and-forget
  runEmbeddingBackfill().catch((err) => console.error("[backfill] Fatal:", err));

  return c.json({ status: "started" });
});

export default router;
```

Mount in `apps/api/src/app.ts`.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/lib/embedding-backfill.ts apps/api/src/routes/admin-embeddings.ts apps/api/src/app.ts
git commit -m "feat(api): add embedding backfill job with admin trigger endpoint"
```

---

## Task 17: AI-Enhanced Features (Conversation Recall, Briefing, Take, Scout Context)

**Files:**
- Modify: `packages/ai/src/skills/recall-memory.ts`
- Modify: `packages/ai/src/context/assembler.ts`

- [ ] **Step 1: Wire recall_memory skill to real search**

Replace the placeholder in `packages/ai/src/skills/recall-memory.ts`:

```typescript
import type { Skill, SkillContext } from "./types.js";
import { hybridSearch } from "../embedding/search.js";

export const recallMemorySkill: Skill = {
  name: "recall_memory",
  description: "Search through past conversations and stored content using semantic search. Use when the user asks about past discussions, previous decisions, or 'what did we talk about'.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "What to search for in memory" },
    },
    required: ["query"],
  },
  modelTier: "small",
  requiresAI: false,
  async execute(params: { query: string }, ctx: SkillContext) {
    const results = await hybridSearch(
      ctx.userId,
      params.query,
      ["conversation"],
      null, // Uses server embedding provider
      ctx.prisma,
      5,
    );

    if (results.length === 0) {
      return { success: true, data: null, message: "No relevant past conversations found." };
    }

    const formatted = results
      .map((r, i) => `${i + 1}. ${r.snippet.slice(0, 300)}`)
      .join("\n\n");

    return {
      success: true,
      data: { memories: results },
      message: `Found ${results.length} relevant past conversations:\n\n${formatted}`,
    };
  },
};
```

Uncomment `recall_memory` in the skill registry (`packages/ai/src/skills/index.ts`).

- [ ] **Step 2: Add embedding context to assembler**

In `packages/ai/src/context/assembler.ts`, add a `loadRelevantContext()` function:

```typescript
import { vectorSearch } from "../embedding/search.js";

async function loadRelevantContext(
  userId: string,
  currentText: string,
  provider: EmbeddingProvider | null,
  prisma: PrismaClient,
): Promise<string> {
  if (!provider) return "";

  const results = await vectorSearch(userId, currentText, null, provider, prisma, 3);
  if (results.length === 0) return "";

  // Load details for top results
  const snippets = results
    .filter((r) => r.snippet.length > 20)
    .map((r) => `- ${r.snippet.slice(0, 300)}`);

  if (snippets.length === 0) return "";

  return `\n\nRelevant context from your history:\n<user_data label="past_context">\n${snippets.join("\n")}\n</user_data>`;
}
```

Call this function in:
- `assembleBriefing()` — embed today's tasks/events, find related historical items
- `assembleBrettsTake()` — embed the target item, find similar past items
- `assembleBrettThread()` — embed the current message, find relevant past conversations

Append the result to the system prompt in each assembler.

- [ ] **Step 3: Typecheck**

```bash
cd /Users/brentbarkman/code/brett && pnpm typecheck
```

- [ ] **Step 4: Commit**

```bash
git add packages/ai/src/skills/recall-memory.ts packages/ai/src/skills/index.ts packages/ai/src/context/assembler.ts
git commit -m "feat(ai): wire recall_memory skill and add embedding context to briefing, take, and thread assemblers"
```

---

## Task 18: Integration Tests

**Files:**
- Create: `apps/api/src/__tests__/embedding-pipeline.test.ts`
- Create: `apps/api/src/__tests__/hybrid-search.test.ts`
- Create: `apps/api/src/__tests__/auto-linking.test.ts`

- [ ] **Step 1: Write embedding pipeline integration tests**

Create `apps/api/src/__tests__/embedding-pipeline.test.ts`:

Test coverage:
- Create item → embedding stored with correct `entityType`, `entityId`, `chunkIndex`
- Update item title → embedding updated (not duplicated), `updatedAt` changed
- Create content item with body → multiple chunks stored
- Update content with shorter body → orphan chunks deleted
- Delete item → all embeddings removed
- Concurrent upserts don't deadlock

- [ ] **Step 2: Write hybrid search integration tests**

Create `apps/api/src/__tests__/hybrid-search.test.ts`:

Test coverage:
- Insert items from different mock clusters → search for cluster A term → cluster A items rank highest
- Keyword-only match (item title contains query, no embedding match) → appears in results
- Vector-only match (embedding match, no keyword match) → appears in results
- Both match → highest score via RRF
- Cross-type search returns items, events, and findings
- Empty query returns empty results
- No embedding provider → graceful fallback to keyword-only

- [ ] **Step 3: Write auto-linking integration tests**

Create `apps/api/src/__tests__/auto-linking.test.ts`:

Test coverage:
- Create two items in same mock cluster (similarity > 0.90) → `ItemLink` auto-created with `source = "embedding"`
- Create items at borderline similarity (0.82) → NO auto-link, returned as suggestion from suggestions endpoint
- Create item far from all others → no links or suggestions
- Auto-link is bidirectional (check both `fromItemId` and `toItemId` queries)
- Unlinking an auto-link works (DELETE /things/:id/links/:linkId)
- Duplicate detection: create near-identical item → `duplicateCandidates` in response

- [ ] **Step 4: Run all tests**

```bash
cd /Users/brentbarkman/code/brett && pnpm test
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/__tests__/embedding-pipeline.test.ts apps/api/src/__tests__/hybrid-search.test.ts apps/api/src/__tests__/auto-linking.test.ts
git commit -m "test(api): add integration tests for embedding pipeline, hybrid search, and auto-linking"
```

---

## Task 19: Migrate ConversationEmbedding → Embedding

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (remove `ConversationEmbedding`)
- New migration
- Modify: `packages/ai/src/memory/embeddings.ts` (rewrite to use `Embedding` table)

- [ ] **Step 1: Create data migration**

Write a migration that:
1. Copies existing `ConversationEmbedding` rows into `Embedding` with `entityType = "conversation"`, `entityId = sessionId`, `chunkIndex = 0`
2. Note: vectors need to be re-embedded at 1024 dims (Voyage) since existing ones are 1536 dims (OpenAI). The backfill job (Task 16) handles this. For the migration, we just drop the old data.

Create migration manually:

```sql
-- Drop old ConversationEmbedding table (data will be re-embedded via backfill)
DROP TABLE IF EXISTS "ConversationEmbedding";
DROP INDEX IF EXISTS conversation_embedding_vector_idx;
```

- [ ] **Step 2: Remove ConversationEmbedding from schema**

Remove the `ConversationEmbedding` model and its relation from `ConversationSession` in `schema.prisma`.

- [ ] **Step 3: Rewrite embeddings.ts**

Replace `packages/ai/src/memory/embeddings.ts` to use the new `Embedding` table:

```typescript
import type { PrismaClient } from "@prisma/client";
import { embedEntity } from "../embedding/pipeline.js";
import type { EmbeddingProvider } from "../providers/types.js";
import { hybridSearch } from "../embedding/search.js";

export async function embedConversation(
  sessionId: string,
  userId: string,
  provider: EmbeddingProvider,
  prisma: PrismaClient,
): Promise<void> {
  await embedEntity({ entityType: "conversation", entityId: sessionId, userId, provider, prisma });
}

export async function searchSimilar(
  userId: string,
  query: string,
  provider: EmbeddingProvider,
  prisma: PrismaClient,
  limit: number = 5,
): Promise<Array<{ chunkText: string; similarity: number }>> {
  const results = await hybridSearch(userId, query, ["conversation"], provider, prisma, limit);
  return results.map((r) => ({ chunkText: r.snippet, similarity: r.score }));
}
```

- [ ] **Step 4: Run migration**

```bash
cd /Users/brentbarkman/code/brett && pnpm db:migrate --name migrate_conversation_embedding
```

- [ ] **Step 5: Typecheck and test**

```bash
cd /Users/brentbarkman/code/brett && pnpm typecheck && pnpm test
```

- [ ] **Step 6: Commit**

```bash
git add apps/api/prisma/ packages/ai/src/memory/embeddings.ts
git commit -m "refactor(db): migrate ConversationEmbedding to universal Embedding table"
```

---

## Task 20: Environment Setup + Graceful Degradation Verification

**Files:**
- Modify: `apps/api/.env.example`
- Verify: graceful degradation when `EMBEDDING_API_KEY` is unset

- [ ] **Step 1: Update .env.example**

Add to `apps/api/.env.example`:

```
# Embedding provider (Voyage AI) — Brett-managed, not user-provided
# Required for semantic search, related items, duplicate detection
# Get a key at https://dash.voyageai.com/
EMBEDDING_API_KEY=
```

- [ ] **Step 2: Test graceful degradation**

Ensure `EMBEDDING_API_KEY` is unset, then verify:
- `GET /api/search?q=test` returns keyword-only results (no errors)
- `GET /api/things/:id/suggestions` returns `{ suggestions: [] }` (no errors)
- `POST /api/things` creates item without duplicate detection (no errors)
- Item creation, update, deletion work normally (embedding triggers are no-ops)

- [ ] **Step 3: Commit**

```bash
git add apps/api/.env.example
git commit -m "chore(api): add EMBEDDING_API_KEY to .env.example and verify graceful degradation"
```

---

## Task 21: Final Typecheck + Full Test Suite

- [ ] **Step 1: Run full typecheck**

```bash
cd /Users/brentbarkman/code/brett && pnpm typecheck
```

- [ ] **Step 2: Run full test suite**

```bash
cd /Users/brentbarkman/code/brett && pnpm test
```

- [ ] **Step 3: Fix any failures**

- [ ] **Step 4: Final commit if any fixes were needed**

```bash
git commit -m "fix: resolve typecheck and test failures from embeddings integration"
```
