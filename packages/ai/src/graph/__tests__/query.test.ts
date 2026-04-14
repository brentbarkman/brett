import { describe, it, expect, vi } from "vitest";
import { buildGraphContext } from "../query.js";

// Mock prisma that returns canned relationships for findConnected
function makeMockPrisma(rows: any[]) {
  return {
    $queryRaw: vi.fn().mockResolvedValue(rows),
  };
}

function makeRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    relId: "rel-1",
    relType: "works_at",
    weight: 0.8,
    sourceId: "ent-1",
    sourceType: "person",
    sourceName: "Jordan Chen",
    sourceProps: {},
    targetId: "ent-2",
    targetType: "company",
    targetName: "Acme Corp",
    targetProps: {},
    depth: 1,
    ...overrides,
  };
}

describe("buildGraphContext", () => {
  it("returns empty string for empty entityIds", async () => {
    const prisma = makeMockPrisma([]);
    const result = await buildGraphContext("user-1", [], prisma);
    expect(result).toBe("");
    // Should not even query
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it("returns empty string when no relationships found", async () => {
    const prisma = makeMockPrisma([]);
    const result = await buildGraphContext("user-1", ["ent-1"], prisma);
    expect(result).toBe("");
  });

  it("formats a single relationship correctly", async () => {
    const prisma = makeMockPrisma([makeRow()]);
    const result = await buildGraphContext("user-1", ["ent-1"], prisma);
    expect(result).toBe(
      "Jordan Chen [person] —works_at→ Acme Corp [company]",
    );
  });

  it("deduplicates relationships by id", async () => {
    const prisma = makeMockPrisma([
      makeRow({ relId: "rel-1" }),
      makeRow({ relId: "rel-1" }), // duplicate
      makeRow({
        relId: "rel-2",
        relType: "manages",
        targetId: "ent-3",
        targetName: "Project Alpha",
        targetType: "project",
      }),
    ]);
    const result = await buildGraphContext("user-1", ["ent-1"], prisma);
    const lines = result.split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("works_at");
    expect(lines[1]).toContain("manages");
  });

  it("limits to first 5 entity IDs", async () => {
    const prisma = makeMockPrisma([]);
    const ids = ["a", "b", "c", "d", "e", "f", "g"];
    await buildGraphContext("user-1", ids, prisma);
    // Should be called 5 times (one per entity, capped at 5)
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(5);
  });

  it("formats multiple relationships as newline-separated", async () => {
    const prisma = makeMockPrisma([
      makeRow({ relId: "rel-1" }),
      makeRow({
        relId: "rel-2",
        relType: "uses",
        sourceId: "ent-2",
        sourceName: "Acme Corp",
        sourceType: "company",
        targetId: "ent-3",
        targetName: "Figma",
        targetType: "tool",
      }),
    ]);
    const result = await buildGraphContext("user-1", ["ent-1"], prisma);
    expect(result).toContain("\n");
    expect(result).toContain("Acme Corp [company] —uses→ Figma [tool]");
  });
});
