/**
 * Integration tests for the hybrid search endpoint (/search).
 *
 * These tests require a running Postgres instance with pgvector.
 * Tests that require vector operations are guarded with a pgvector check.
 *
 * Tests that only exercise keyword search or input validation run against
 * the real DB without pgvector-specific SQL and are not guarded.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { createTestUser, authRequest } from "./helpers.js";
import { prisma } from "../lib/prisma.js";
import { setEmbeddingProvider } from "../lib/embedding-provider.js";
import { setEmbedProcessor, flushEmbedQueue, embedEntity } from "@brett/ai";
import { MockEmbeddingProvider } from "@brett/ai";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function pgvectorAvailable(): Promise<boolean> {
  try {
    await prisma.$executeRaw`SELECT 1 FROM "Embedding" LIMIT 0`;
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("Hybrid search endpoint", () => {
  let token: string;
  let hasPgvector: boolean;

  const mock = new MockEmbeddingProvider();

  beforeAll(async () => {
    hasPgvector = await pgvectorAvailable();

    const user = await createTestUser("Hybrid Search User");
    token = user.token;

    setEmbeddingProvider(mock);
    setEmbedProcessor(async (job) => {
      await embedEntity({ ...job, provider: mock, prisma });
    });

    // Create some known items for searching
    await authRequest("/things", token, {
      method: "POST",
      body: JSON.stringify({ type: "task", title: "budget review for Q3" }),
    });
    await authRequest("/things", token, {
      method: "POST",
      body: JSON.stringify({ type: "task", title: "engineering hiring plan" }),
    });
    await authRequest("/things", token, {
      method: "POST",
      body: JSON.stringify({ type: "task", title: "weekly team standup" }),
    });

    // Flush queue so embeddings are stored before the search tests run
    await flushEmbedQueue();
  });

  // ── Input validation ───────────────────────────────────────────────────────

  it("returns 400 for empty query", async () => {
    const res = await authRequest("/api/search?q=", token);
    expect(res.status).toBe(400);
  });

  it("returns 400 for single-char query", async () => {
    const res = await authRequest("/api/search?q=x", token);
    expect(res.status).toBe(400);
  });

  it("returns 401 without auth", async () => {
    const { app } = await import("../app.js");
    const noAuthRes = await app.request("/api/search?q=budget");
    expect(noAuthRes.status).toBe(401);
  });

  // ── Keyword search ──────────────────────────────────────────────────────────

  it("keyword search finds items by title", async () => {
    const res = await authRequest("/api/search?q=budget+review", token);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.results).toBeDefined();
    expect(Array.isArray(body.results)).toBe(true);

    const titles = body.results.map((r: any) => r.title as string);
    expect(titles.some((t) => t.toLowerCase().includes("budget"))).toBe(true);
  });

  it("search returns correct result structure", async () => {
    const res = await authRequest("/api/search?q=hiring", token);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.results).toBeDefined();

    if (body.results.length > 0) {
      const result = body.results[0];
      // All required fields must be present
      expect(result).toHaveProperty("entityType");
      expect(result).toHaveProperty("entityId");
      expect(result).toHaveProperty("title");
      expect(result).toHaveProperty("snippet");
      expect(result).toHaveProperty("score");
      expect(result).toHaveProperty("matchType");
      expect(result).toHaveProperty("metadata");
      // matchType must be one of the expected values
      expect(["keyword", "semantic", "both"]).toContain(result.matchType);
    }
  });

  it("search results are item entities with correct metadata shape", async () => {
    const res = await authRequest("/api/search?q=standup", token);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;

    const itemResults = body.results.filter((r: any) => r.entityType === "item");
    for (const result of itemResults) {
      // Items should have their metadata enriched by the route
      expect(result.metadata).toBeDefined();
    }
  });

  it("respects the limit parameter", async () => {
    const res = await authRequest("/api/search?q=budget&limit=1", token);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.results.length).toBeLessThanOrEqual(1);
  });

  it("results are isolated to the authenticated user", async () => {
    // Create a separate user with their own item
    const otherUser = await createTestUser("Other Search User");
    await authRequest("/things", otherUser.token, {
      method: "POST",
      body: JSON.stringify({ type: "task", title: "secret other user budget" }),
    });
    await flushEmbedQueue();

    // Search as the original user — should not see the other user's item
    const res = await authRequest("/api/search?q=secret+other+user", token);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;

    // None of the results should contain the other user's item
    const titles = body.results.map((r: any) => r.title as string);
    expect(titles.some((t) => t.toLowerCase().includes("secret other user"))).toBe(false);
  });

  // ── No embedding provider → keyword-only fallback ─────────────────────────

  it("gracefully falls back to keyword-only search when no embedding provider", async () => {
    setEmbeddingProvider(null);
    try {
      const res = await authRequest("/api/search?q=hiring+plan", token);
      // Should still return 200 (keyword search works without a vector provider)
      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.results).toBeDefined();
      expect(Array.isArray(body.results)).toBe(true);
      // Keyword match should still find the hiring item
      const titles = body.results.map((r: any) => r.title as string);
      expect(titles.some((t) => t.toLowerCase().includes("hiring"))).toBe(true);
    } finally {
      setEmbeddingProvider(mock);
    }
  });
});
