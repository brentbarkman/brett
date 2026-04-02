/**
 * Tests for auto-linking behavior.
 *
 * Includes:
 *   - Pure unit tests for classifyMatches (no DB required)
 *   - Schema-level assertion that ItemLink.source accepts "embedding"
 *
 * classifyMatches is a pure function — these tests always run regardless
 * of whether a Postgres/pgvector instance is available.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { classifyMatches } from "@brett/ai";
import { AI_CONFIG } from "@brett/ai";
import { createTestUser, authRequest } from "./helpers.js";
import { prisma } from "../lib/prisma.js";
import { setEmbeddingProvider } from "../lib/embedding-provider.js";
import { setEmbedProcessor, flushEmbedQueue, embedEntity } from "@brett/ai";
import { MockEmbeddingProvider } from "@brett/ai";

// ---------------------------------------------------------------------------
// Unit tests — pure function, no DB
// ---------------------------------------------------------------------------

describe("classifyMatches (unit)", () => {
  const { autoLinkThreshold, suggestThreshold } = AI_CONFIG.embedding;

  it("places matches above autoLinkThreshold into autoLinks", () => {
    const matches = [
      { entityId: "a", similarity: autoLinkThreshold },
      { entityId: "b", similarity: autoLinkThreshold + 0.01 },
    ];
    const { autoLinks, suggestions } = classifyMatches(matches);
    expect(autoLinks).toHaveLength(2);
    expect(suggestions).toHaveLength(0);
    expect(autoLinks.map((m) => m.entityId)).toContain("a");
    expect(autoLinks.map((m) => m.entityId)).toContain("b");
  });

  it("places matches between suggestThreshold and autoLinkThreshold into suggestions", () => {
    const mid = (suggestThreshold + autoLinkThreshold) / 2;
    const matches = [
      { entityId: "c", similarity: mid },
      { entityId: "d", similarity: suggestThreshold },
    ];
    const { autoLinks, suggestions } = classifyMatches(matches);
    expect(autoLinks).toHaveLength(0);
    expect(suggestions).toHaveLength(2);
    expect(suggestions.map((m) => m.entityId)).toContain("c");
    expect(suggestions.map((m) => m.entityId)).toContain("d");
  });

  it("discards matches below suggestThreshold", () => {
    const matches = [
      { entityId: "e", similarity: suggestThreshold - 0.01 },
      { entityId: "f", similarity: 0.1 },
      { entityId: "g", similarity: 0 },
    ];
    const { autoLinks, suggestions } = classifyMatches(matches);
    expect(autoLinks).toHaveLength(0);
    expect(suggestions).toHaveLength(0);
  });

  it("handles an empty array", () => {
    const { autoLinks, suggestions } = classifyMatches([]);
    expect(autoLinks).toHaveLength(0);
    expect(suggestions).toHaveLength(0);
  });

  it("handles a mix of all three categories correctly", () => {
    const matches = [
      { entityId: "auto1", similarity: 0.95 },
      { entityId: "auto2", similarity: autoLinkThreshold },
      { entityId: "suggest1", similarity: 0.80 },
      { entityId: "suggest2", similarity: suggestThreshold },
      { entityId: "discard1", similarity: suggestThreshold - 0.01 },
    ];
    const { autoLinks, suggestions } = classifyMatches(matches);
    expect(autoLinks.map((m) => m.entityId)).toEqual(
      expect.arrayContaining(["auto1", "auto2"])
    );
    expect(suggestions.map((m) => m.entityId)).toEqual(
      expect.arrayContaining(["suggest1", "suggest2"])
    );
    // Discarded item must not appear in either list
    expect([...autoLinks, ...suggestions].map((m) => m.entityId)).not.toContain("discard1");
  });

  it("respects exact threshold boundary: autoLinkThreshold is inclusive", () => {
    const { autoLinks } = classifyMatches([
      { entityId: "boundary", similarity: autoLinkThreshold },
    ]);
    expect(autoLinks).toHaveLength(1);
  });

  it("respects exact threshold boundary: suggestThreshold is inclusive", () => {
    const { suggestions } = classifyMatches([
      { entityId: "boundary", similarity: suggestThreshold },
    ]);
    expect(suggestions).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Schema test — ItemLink.source accepts "embedding"
// ---------------------------------------------------------------------------

describe("ItemLink source field accepts 'embedding'", () => {
  let token: string;
  let userId: string;

  const mock = new MockEmbeddingProvider();

  beforeAll(async () => {
    const user = await createTestUser("Auto Link Schema User");
    token = user.token;
    userId = user.userId;

    setEmbeddingProvider(mock);
    setEmbedProcessor(async (job) => {
      await embedEntity({ ...job, provider: mock, prisma });
    });
  });

  it("can create an ItemLink with source = 'embedding' directly via Prisma", async () => {
    // Create two items
    const res1 = await authRequest("/things", token, {
      method: "POST",
      body: JSON.stringify({ type: "task", title: "Auto link source test A" }),
    });
    const res2 = await authRequest("/things", token, {
      method: "POST",
      body: JSON.stringify({ type: "task", title: "Auto link source test B" }),
    });
    const { id: idA } = (await res1.json()) as any;
    const { id: idB } = (await res2.json()) as any;

    // Create an ItemLink with source = "embedding" — this verifies the schema accepts it
    const link = await prisma.itemLink.create({
      data: {
        fromItemId: idA,
        toItemId: idB,
        toItemType: "task",
        source: "embedding",
        userId,
      },
    });

    expect(link.source).toBe("embedding");
    expect(link.fromItemId).toBe(idA);
    expect(link.toItemId).toBe(idB);

    // Cleanup
    await prisma.itemLink.delete({ where: { id: link.id } });
  });

  it("ItemLink source defaults to 'manual' when not specified", async () => {
    const res1 = await authRequest("/things", token, {
      method: "POST",
      body: JSON.stringify({ type: "task", title: "Manual link default source A" }),
    });
    const res2 = await authRequest("/things", token, {
      method: "POST",
      body: JSON.stringify({ type: "task", title: "Manual link default source B" }),
    });
    const { id: idA } = (await res1.json()) as any;
    const { id: idB } = (await res2.json()) as any;

    const link = await prisma.itemLink.create({
      data: {
        fromItemId: idA,
        toItemId: idB,
        toItemType: "task",
        userId,
        // source intentionally omitted — should default to "manual"
      },
    });

    expect(link.source).toBe("manual");

    // Cleanup
    await prisma.itemLink.delete({ where: { id: link.id } });
  });
});

// ---------------------------------------------------------------------------
// Integration test — auto-link created when two near-duplicate items are embedded
// ---------------------------------------------------------------------------

describe("Auto-linking via embedding pipeline", () => {
  let token: string;
  let userId: string;
  let hasPgvector: boolean;

  const mock = new MockEmbeddingProvider();

  beforeAll(async () => {
    // Check pgvector availability
    try {
      await prisma.$executeRaw`SELECT 1 FROM "Embedding" LIMIT 0`;
      hasPgvector = true;
    } catch {
      hasPgvector = false;
    }

    const user = await createTestUser("Auto Link Integration User");
    token = user.token;
    userId = user.userId;

    setEmbeddingProvider(mock);
    setEmbedProcessor(async (job) => {
      await embedEntity({ ...job, provider: mock, prisma });
    });
  });

  it("creates an auto-link between near-duplicate items after embedding", async () => {
    if (!hasPgvector) {
      console.warn("Skipping: pgvector not available");
      return;
    }

    // Create two items and embed them.
    // NOTE: The MockEmbeddingProvider clusters on exact title strings. The assembler
    // prepends "[Task] " so the full chunk text is "[Task] Review Q3 budget", etc.
    // We insert matching embeddings directly to simulate two near-duplicate items
    // instead of relying on the mock's cluster matching (which keys on raw title only).
    const res1 = await authRequest("/things", token, {
      method: "POST",
      body: JSON.stringify({ type: "task", title: "near-dup alpha" }),
    });
    const { id: id1 } = (await res1.json()) as any;

    const res2 = await authRequest("/things", token, {
      method: "POST",
      body: JSON.stringify({ type: "task", title: "near-dup beta" }),
    });
    const { id: id2 } = (await res2.json()) as any;

    // We want item1 and item2 to have very similar embeddings so auto-linking fires.
    // Strategy: seed item2's embedding using the same text that embedEntity will generate
    // for item1 (i.e. assembleItemText produces "[Task] near-dup alpha"). That way when
    // embedEntity runs for item1, it generates a vector for "[Task] near-dup alpha" and
    // item2 already has that same vector — similarity = 1.0 > autoLinkThreshold.
    const item1AssembledText = "[Task] near-dup alpha";
    const sharedVector = await mock.embed(item1AssembledText, "document");
    const vectorStr = `[${sharedVector.join(",")}]`;

    // Seed item2 with item1's assembled text vector
    await prisma.$executeRawUnsafe(
      `INSERT INTO "Embedding" (id, "userId", "entityType", "entityId", "chunkIndex", "chunkText", embedding, "createdAt", "updatedAt")
       VALUES (gen_random_uuid(), $1, 'item', $2, 0, $3, $4::vector, NOW(), NOW())
       ON CONFLICT ("entityType", "entityId", "chunkIndex")
       DO UPDATE SET "chunkText" = $3, embedding = $4::vector, "updatedAt" = NOW()`,
      userId, id2, item1AssembledText, vectorStr
    );

    // Now run embedEntity for item1 — it will:
    //   1. Assemble "[Task] near-dup alpha" and embed it → same vector as what item2 has
    //   2. Query for similar items → finds item2 with similarity = 1.0
    //   3. Since 1.0 >= autoLinkThreshold (0.90), creates an auto-link
    await embedEntity({ entityType: "item", entityId: id1, userId, provider: mock, prisma });

    // Check if an auto-link was created between the two items
    const link = await prisma.itemLink.findFirst({
      where: {
        OR: [
          { fromItemId: id1, toItemId: id2 },
          { fromItemId: id2, toItemId: id1 },
        ],
        source: "embedding",
      },
    });

    // The auto-link should exist since similarity = 1.0 > autoLinkThreshold 0.90
    expect(link).not.toBeNull();
    if (link) {
      expect(link.source).toBe("embedding");
    }
  });

  it("does not create duplicate auto-links on re-embed", async () => {
    if (!hasPgvector) {
      console.warn("Skipping: pgvector not available");
      return;
    }

    const res1 = await authRequest("/things", token, {
      method: "POST",
      body: JSON.stringify({ type: "task", title: "dedup re-embed alpha" }),
    });
    const res2 = await authRequest("/things", token, {
      method: "POST",
      body: JSON.stringify({ type: "task", title: "dedup re-embed beta" }),
    });
    const { id: id1 } = (await res1.json()) as any;
    const { id: id2 } = (await res2.json()) as any;

    // Seed item2 with item1's assembled text vector so similarity = 1.0
    const item1AssembledText = "[Task] dedup re-embed alpha";
    const sharedVector = await mock.embed(item1AssembledText, "document");
    const vectorStr = `[${sharedVector.join(",")}]`;

    await prisma.$executeRawUnsafe(
      `INSERT INTO "Embedding" (id, "userId", "entityType", "entityId", "chunkIndex", "chunkText", embedding, "createdAt", "updatedAt")
       VALUES (gen_random_uuid(), $1, 'item', $2, 0, $3, $4::vector, NOW(), NOW())
       ON CONFLICT ("entityType", "entityId", "chunkIndex")
       DO UPDATE SET "chunkText" = $3, embedding = $4::vector, "updatedAt" = NOW()`,
      userId, id2, item1AssembledText, vectorStr
    );

    // Run embedEntity for item1 — creates auto-link (similarity = 1.0)
    await embedEntity({ entityType: "item", entityId: id1, userId, provider: mock, prisma });

    // Re-embed item1 again — should NOT create a second link (dedup logic)
    await embedEntity({ entityType: "item", entityId: id1, userId, provider: mock, prisma });

    // Count links between these two items
    const links = await prisma.itemLink.findMany({
      where: {
        OR: [
          { fromItemId: id1, toItemId: id2 },
          { fromItemId: id2, toItemId: id1 },
        ],
        source: "embedding",
      },
    });

    // Should have at most 1 link, not 2
    expect(links.length).toBeLessThanOrEqual(1);
  });
});
