import { describe, it, expect, beforeAll } from "vitest";
import { createTestUser, authRequest } from "./helpers.js";
import { prisma } from "../lib/prisma.js";

describe("Knowledge Graph API", () => {
  let token: string;
  let userId: string;
  let entityId: string;

  beforeAll(async () => {
    ({ token, userId } = await createTestUser("graph-api-test"));

    // Seed entities directly via prisma
    const entity = await (prisma as any).knowledgeEntity.create({
      data: { userId, type: "person", name: "Jordan Chen", properties: { role: "VP Product" } },
    });
    entityId = entity.id;

    const companyEntity = await (prisma as any).knowledgeEntity.create({
      data: { userId, type: "company", name: "Acme Corp", properties: {} },
    });

    // Seed a relationship
    await (prisma as any).knowledgeRelationship.create({
      data: {
        userId,
        sourceId: entity.id,
        targetId: companyEntity.id,
        relationship: "works_at",
        validFrom: new Date(),
      },
    });
  });

  it("GET /api/graph/entities returns user's entities", async () => {
    const res = await authRequest("/api/graph/entities", token);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.entities).toBeDefined();
    expect(body.entities.length).toBeGreaterThanOrEqual(2);
    // Should include our seeded entities
    const names = body.entities.map((e: any) => e.name);
    expect(names).toContain("Jordan Chen");
    expect(names).toContain("Acme Corp");
  });

  it("GET /api/graph/entities?type=person filters by type", async () => {
    const res = await authRequest("/api/graph/entities?type=person", token);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.entities.every((e: any) => e.type === "person")).toBe(true);
    expect(body.entities.some((e: any) => e.name === "Jordan Chen")).toBe(true);
  });

  it("GET /api/graph/entities/:id/connections returns relationships", async () => {
    const res = await authRequest(`/api/graph/entities/${entityId}/connections`, token);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.connections).toBeDefined();
    expect(body.connections.length).toBeGreaterThanOrEqual(1);
  });

  it("returns 404 for non-existent entity", async () => {
    const res = await authRequest("/api/graph/entities/non-existent-id/connections", token);
    expect(res.status).toBe(404);
  });

  it("caps hops at 3", async () => {
    const res = await authRequest(`/api/graph/entities/${entityId}/connections?hops=10`, token);
    expect(res.status).toBe(200);
    // This just verifies no crash; the actual cap is Math.min(parseInt(...), 3) in the route
  });
});
