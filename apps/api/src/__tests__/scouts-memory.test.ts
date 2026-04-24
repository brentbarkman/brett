import { describe, it, expect, beforeAll } from "vitest";
import { createTestUser, authRequest } from "./helpers.js";
import { prisma } from "../lib/prisma.js";

describe("Scout memory routes", () => {
  let token: string;
  let userId: string;
  let scoutId: string;
  let findingId: string;
  let itemId: string;

  beforeAll(async () => {
    const user = await createTestUser("Scout Memory User");
    token = user.token;
    userId = user.userId;

    // Create a scout directly in DB
    const scout = await prisma.scout.create({
      data: {
        userId,
        name: "Test Scout",
        avatarLetter: "T",
        avatarGradientFrom: "#3b82f6",
        avatarGradientTo: "#8b5cf6",
        goal: "Monitor test events",
        sources: [{ name: "Test Source" }],
        sensitivity: "medium",
        cadenceIntervalHours: 24,
        cadenceMinIntervalHours: 1,
        cadenceCurrentIntervalHours: 24,
        budgetTotal: 100,
        budgetResetAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });
    scoutId = scout.id;

    // Create an item (simulating auto-promote from scout runner)
    const item = await prisma.item.create({
      data: {
        userId,
        type: "content",
        title: "Test Finding Item",
        source: "scout",
        sourceId: scoutId,
        status: "active",
      },
    });
    itemId = item.id;

    // Create a scout run
    const run = await prisma.scoutRun.create({
      data: { scoutId, status: "success" },
    });

    // Create a finding linked to the item
    const finding = await prisma.scoutFinding.create({
      data: {
        scoutId,
        scoutRunId: run.id,
        userId,
        type: "insight",
        title: "Test Finding",
        description: "A test finding description",
        sourceName: "Test Source",
        relevanceScore: 0.8,
        reasoning: "Relevant to goal",
        itemId: item.id,
      },
    });
    findingId = finding.id;

    // Create some memories
    await prisma.scoutMemory.createMany({
      data: [
        { scoutId, type: "factual", content: "Test fact one", confidence: 0.9, status: "active", sourceRunIds: [run.id] },
        { scoutId, type: "judgment", content: "User prefers X over Y", confidence: 0.7, status: "active", sourceRunIds: [run.id] },
        { scoutId, type: "pattern", content: "Trend increasing", confidence: 0.6, status: "active", sourceRunIds: [run.id] },
        { scoutId, type: "factual", content: "Superseded fact", confidence: 0.5, status: "superseded", sourceRunIds: [run.id] },
      ],
    });
  });

  // ── Feedback endpoint ──

  describe("POST /scouts/:id/findings/:findingId/feedback", () => {
    it("sets feedback to useful", async () => {
      const res = await authRequest(`/scouts/${scoutId}/findings/${findingId}/feedback`, token, {
        method: "POST",
        body: JSON.stringify({ useful: true }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.feedbackUseful).toBe(true);
      expect(body.feedbackAt).toBeTruthy();
    });

    it("sets feedback to not useful", async () => {
      const res = await authRequest(`/scouts/${scoutId}/findings/${findingId}/feedback`, token, {
        method: "POST",
        body: JSON.stringify({ useful: false }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.feedbackUseful).toBe(false);
    });

    it("clears feedback with null", async () => {
      const res = await authRequest(`/scouts/${scoutId}/findings/${findingId}/feedback`, token, {
        method: "POST",
        body: JSON.stringify({ useful: null }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.feedbackUseful).toBeNull();
      expect(body.feedbackAt).toBeFalsy();
    });

    it("rejects invalid useful value", async () => {
      const res = await authRequest(`/scouts/${scoutId}/findings/${findingId}/feedback`, token, {
        method: "POST",
        body: JSON.stringify({ useful: "yes" }),
      });
      expect(res.status).toBe(400);
    });

    it("returns 404 for nonexistent scout", async () => {
      const res = await authRequest(`/scouts/nonexistent/findings/${findingId}/feedback`, token, {
        method: "POST",
        body: JSON.stringify({ useful: true }),
      });
      expect(res.status).toBe(404);
    });

    it("returns 404 for nonexistent finding", async () => {
      const res = await authRequest(`/scouts/${scoutId}/findings/nonexistent/feedback`, token, {
        method: "POST",
        body: JSON.stringify({ useful: true }),
      });
      expect(res.status).toBe(404);
    });

    it("prevents cross-user access", async () => {
      const other = await createTestUser("Other User");
      const res = await authRequest(`/scouts/${scoutId}/findings/${findingId}/feedback`, other.token, {
        method: "POST",
        body: JSON.stringify({ useful: true }),
      });
      expect(res.status).toBe(404);
    });
  });

  // ── Memories endpoints ──

  describe("GET /scouts/:id/memories", () => {
    it("returns active memories only", async () => {
      const res = await authRequest(`/scouts/${scoutId}/memories`, token);
      expect(res.status).toBe(200);
      const body = (await res.json()) as any[];
      // Should have 3 active, not the superseded one
      expect(body).toHaveLength(3);
      expect(body.every((m: any) => m.status === "active")).toBe(true);
    });

    it("filters by type", async () => {
      const res = await authRequest(`/scouts/${scoutId}/memories?type=factual`, token);
      expect(res.status).toBe(200);
      const body = (await res.json()) as any[];
      expect(body).toHaveLength(1);
      expect(body[0].type).toBe("factual");
      expect(body[0].content).toBe("Test fact one");
    });

    it("orders by type then confidence desc", async () => {
      const res = await authRequest(`/scouts/${scoutId}/memories`, token);
      const body = (await res.json()) as any[];
      // factual (0.9), judgment (0.7), pattern (0.6) — ordered by type asc then confidence desc
      const types = body.map((m: any) => m.type);
      expect(types).toEqual(["factual", "judgment", "pattern"]);
    });

    it("returns 404 for nonexistent scout", async () => {
      const res = await authRequest("/scouts/nonexistent/memories", token);
      expect(res.status).toBe(404);
    });

    it("prevents cross-user access", async () => {
      const other = await createTestUser("Other Memories User");
      const res = await authRequest(`/scouts/${scoutId}/memories`, other.token);
      expect(res.status).toBe(404);
    });
  });

  describe("DELETE /scouts/:id/memories/:memoryId", () => {
    let memoryToDelete: string;

    beforeAll(async () => {
      // Create a memory to delete
      const mem = await prisma.scoutMemory.create({
        data: { scoutId, type: "factual", content: "Delete me", confidence: 0.5, status: "active", sourceRunIds: [] },
      });
      memoryToDelete = mem.id;
    });

    it("soft-deletes a memory (sets user_deleted)", async () => {
      const res = await authRequest(`/scouts/${scoutId}/memories/${memoryToDelete}`, token, {
        method: "DELETE",
      });
      expect(res.status).toBe(204);

      // Verify it's no longer in active list
      const listRes = await authRequest(`/scouts/${scoutId}/memories`, token);
      const memories = (await listRes.json()) as any[];
      expect(memories.find((m: any) => m.id === memoryToDelete)).toBeUndefined();

      // Verify DB status
      const dbMem = await prisma.scoutMemory.findUnique({ where: { id: memoryToDelete } });
      expect(dbMem?.status).toBe("user_deleted");
      expect(dbMem?.supersededAt).toBeTruthy();
    });

    it("returns 404 for already-deleted memory", async () => {
      const res = await authRequest(`/scouts/${scoutId}/memories/${memoryToDelete}`, token, {
        method: "DELETE",
      });
      expect(res.status).toBe(404);
    });

    it("returns 404 for nonexistent memory", async () => {
      const res = await authRequest(`/scouts/${scoutId}/memories/nonexistent`, token, {
        method: "DELETE",
      });
      expect(res.status).toBe(404);
    });

    it("prevents cross-user deletion", async () => {
      const mem = await prisma.scoutMemory.create({
        data: { scoutId, type: "factual", content: "Protected", confidence: 0.5, status: "active", sourceRunIds: [] },
      });
      const other = await createTestUser("Delete Attacker");
      const res = await authRequest(`/scouts/${scoutId}/memories/${mem.id}`, other.token, {
        method: "DELETE",
      });
      expect(res.status).toBe(404);
      // Verify not deleted
      const dbMem = await prisma.scoutMemory.findUnique({ where: { id: mem.id } });
      expect(dbMem?.status).toBe("active");
    });
  });

  // ── Findings with feedback + completion status ──

  describe("GET /scouts/:id/findings", () => {
    it("includes feedbackUseful in findings", async () => {
      // Set feedback first
      await authRequest(`/scouts/${scoutId}/findings/${findingId}/feedback`, token, {
        method: "POST",
        body: JSON.stringify({ useful: true }),
      });

      const res = await authRequest(`/scouts/${scoutId}/findings`, token);
      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      const finding = body.findings.find((f: any) => f.id === findingId);
      expect(finding.feedbackUseful).toBe(true);
      expect(finding.feedbackAt).toBeTruthy();
    });

    it("includes itemCompleted status", async () => {
      const res = await authRequest(`/scouts/${scoutId}/findings`, token);
      const body = (await res.json()) as any;
      const finding = body.findings.find((f: any) => f.id === findingId);
      expect(finding.itemCompleted).toBe(false);

      // Mark item as done
      await prisma.item.update({ where: { id: itemId }, data: { status: "done" } });

      const res2 = await authRequest(`/scouts/${scoutId}/findings`, token);
      const body2 = (await res2.json()) as any;
      const finding2 = body2.findings.find((f: any) => f.id === findingId);
      expect(finding2.itemCompleted).toBe(true);

      // Restore for other tests
      await prisma.item.update({ where: { id: itemId }, data: { status: "active" } });
    });
  });

  // ── ThingDetail enrichment ──

  describe("GET /things/:id (scout enrichment)", () => {
    it("includes scoutFindingId and scoutFeedbackUseful", async () => {
      // Set feedback
      await authRequest(`/scouts/${scoutId}/findings/${findingId}/feedback`, token, {
        method: "POST",
        body: JSON.stringify({ useful: false }),
      });

      const res = await authRequest(`/things/${itemId}`, token);
      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.scoutFindingId).toBe(findingId);
      expect(body.scoutFeedbackUseful).toBe(false);
      expect(body.scoutName).toBe("Test Scout");
      expect(body.scoutId).toBe(scoutId);
    });
  });

});
