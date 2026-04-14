import { describe, it, expect, beforeAll } from "vitest";
import { createTestUser, authRequest } from "./helpers.js";
import { prisma } from "../lib/prisma.js";

describe("Knowledge Graph — Tenant Isolation", () => {
  let userA: { token: string; userId: string };
  let userB: { token: string; userId: string };
  let userAEntityId: string;

  beforeAll(async () => {
    userA = await createTestUser("isolation-a");
    userB = await createTestUser("isolation-b");

    // Create entities for user A only
    const entity = await (prisma as any).knowledgeEntity.create({
      data: { userId: userA.userId, type: "person", name: "Secret Contact", properties: {} },
    });
    userAEntityId = entity.id;
  });

  it("user B cannot see user A's entities via API", async () => {
    const res = await authRequest("/api/graph/entities", userB.token);
    const body = (await res.json()) as any;
    const names = body.entities.map((e: any) => e.name);
    expect(names).not.toContain("Secret Contact");
  });

  it("user B cannot access user A's entity connections", async () => {
    const res = await authRequest(`/api/graph/entities/${userAEntityId}/connections`, userB.token);
    expect(res.status).toBe(404); // Entity not found for user B
  });
});
