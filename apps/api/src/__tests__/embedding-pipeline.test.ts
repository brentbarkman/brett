/**
 * Integration tests for the embedding pipeline.
 *
 * These tests require:
 *   - A running Postgres instance with the pgvector extension enabled
 *   - DATABASE_URL set in the test environment (done in setup.ts)
 *
 * They use MockEmbeddingProvider so no real API keys are needed.
 * Tests that touch pgvector SQL are wrapped with a pgvector availability check
 * and skipped gracefully when the extension is not present.
 */

import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { createTestUser, authRequest } from "./helpers.js";
import { prisma } from "../lib/prisma.js";
import { setEmbeddingProvider } from "../lib/embedding-provider.js";
import { setEmbedProcessor, flushEmbedQueue } from "@brett/ai";
import { embedEntity } from "@brett/ai";
import { MockEmbeddingProvider } from "@brett/ai";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Check whether pgvector is installed in the test DB. */
async function pgvectorAvailable(): Promise<boolean> {
  try {
    await prisma.$executeRaw`SELECT 1 FROM "Embedding" LIMIT 0`;
    return true;
  } catch {
    return false;
  }
}

/** Query raw embedding rows for a given entity. */
async function getEmbeddingRows(entityType: string, entityId: string) {
  return prisma.$queryRaw<
    Array<{ entityType: string; entityId: string; chunkText: string; chunkIndex: number }>
  >`
    SELECT "entityType", "entityId", "chunkText", "chunkIndex"
    FROM "Embedding"
    WHERE "entityType" = ${entityType}
      AND "entityId" = ${entityId}
    ORDER BY "chunkIndex"
  `;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("Embedding pipeline integration", () => {
  let token: string;
  let userId: string;
  let hasPgvector: boolean;

  const mock = new MockEmbeddingProvider();

  beforeAll(async () => {
    hasPgvector = await pgvectorAvailable();

    const user = await createTestUser("Embedding Pipeline User");
    token = user.token;
    userId = user.userId;

    // Inject the mock provider so inline embed runs in POST /things
    setEmbeddingProvider(mock);

    // Also wire up the queue processor so enqueueEmbed (used by PATCH) works
    setEmbedProcessor(async (job) => {
      await embedEntity({ ...job, provider: mock, prisma });
    });
  });

  afterEach(() => {
    // Reset provider to null so other test files are not affected
    // (each suite re-sets it in beforeAll)
  });

  // ── Create triggers embedding ──────────────────────────────────────────────

  it("creates an embedding when a task item is created via POST /things", async () => {
    if (!hasPgvector) {
      console.warn("Skipping: pgvector not available");
      return;
    }

    const res = await authRequest("/things", token, {
      method: "POST",
      body: JSON.stringify({ type: "task", title: "Review Q3 budget" }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    const itemId: string = body.id;

    const rows = await getEmbeddingRows("item", itemId);
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0].entityType).toBe("item");
    expect(rows[0].entityId).toBe(itemId);
    expect(rows[0].chunkIndex).toBe(0);
    // The chunk text should contain the item title
    expect(rows[0].chunkText.toLowerCase()).toContain("review q3 budget");
  });

  it("embedding has the correct entityType and entityId", async () => {
    if (!hasPgvector) {
      console.warn("Skipping: pgvector not available");
      return;
    }

    const res = await authRequest("/things", token, {
      method: "POST",
      body: JSON.stringify({ type: "task", title: "Q3 financials" }),
    });
    const { id: itemId } = (await res.json()) as any;

    const rows = await getEmbeddingRows("item", itemId);
    expect(rows.length).toBeGreaterThanOrEqual(1);
    for (const row of rows) {
      expect(row.entityType).toBe("item");
      expect(row.entityId).toBe(itemId);
    }
  });

  // ── Update re-embeds ──────────────────────────────────────────────────────

  it("re-embeds when a task title is updated via PATCH /things/:id", async () => {
    if (!hasPgvector) {
      console.warn("Skipping: pgvector not available");
      return;
    }

    // Create item
    const createRes = await authRequest("/things", token, {
      method: "POST",
      body: JSON.stringify({ type: "task", title: "Original title" }),
    });
    const { id: itemId } = (await createRes.json()) as any;

    // Note original chunk text
    const before = await getEmbeddingRows("item", itemId);
    const originalChunkText = before[0]?.chunkText ?? "";

    // Update title — triggers enqueueEmbed
    const patchRes = await authRequest(`/things/${itemId}`, token, {
      method: "PATCH",
      body: JSON.stringify({ title: "Updated title for embedding test" }),
    });
    expect(patchRes.status).toBe(200);

    // Flush the debounce queue so the embed runs synchronously
    await flushEmbedQueue();

    const after = await getEmbeddingRows("item", itemId);
    expect(after.length).toBeGreaterThanOrEqual(1);
    const updatedChunkText = after[0]?.chunkText ?? "";
    // The chunk text should reflect the new title
    expect(updatedChunkText.toLowerCase()).toContain("updated title");
    // And it should differ from the original
    expect(updatedChunkText).not.toBe(originalChunkText);
  });

  // ── Delete removes embeddings ──────────────────────────────────────────────

  it("removes embeddings when an item is deleted via DELETE /things/:id", async () => {
    if (!hasPgvector) {
      console.warn("Skipping: pgvector not available");
      return;
    }

    // Create item and confirm embedding was stored
    const createRes = await authRequest("/things", token, {
      method: "POST",
      body: JSON.stringify({ type: "task", title: "Delete me embedding test" }),
    });
    const { id: itemId } = (await createRes.json()) as any;

    const before = await getEmbeddingRows("item", itemId);
    expect(before.length).toBeGreaterThanOrEqual(1);

    // Delete the item
    const deleteRes = await authRequest(`/things/${itemId}`, token, {
      method: "DELETE",
    });
    expect(deleteRes.status).toBe(200);

    // Embeddings should be gone
    const after = await getEmbeddingRows("item", itemId);
    expect(after.length).toBe(0);
  });

  // ── No provider → queue fallback ──────────────────────────────────────────

  it("does not crash item creation when embedding provider is null", async () => {
    setEmbeddingProvider(null);
    try {
      const res = await authRequest("/things", token, {
        method: "POST",
        body: JSON.stringify({ type: "task", title: "No provider task" }),
      });
      // Item should still be created successfully even without a provider
      expect(res.status).toBe(201);
      const body = (await res.json()) as any;
      expect(body.title).toBe("No provider task");
    } finally {
      // Restore mock provider for subsequent tests
      setEmbeddingProvider(mock);
    }
  });
});
