import { describe, it, expect, vi } from "vitest";
import { upsertGraph } from "../store.js";
import type { ExtractionResult } from "../types.js";

function createMockPrisma() {
  return {
    knowledgeEntity: {
      upsert: vi.fn().mockResolvedValue({ id: "ent-1" }),
    },
    knowledgeRelationship: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: "rel-1" }),
      update: vi.fn().mockResolvedValue({}),
    },
    $executeRaw: vi.fn().mockResolvedValue(1),
  };
}

function makeExtraction(overrides: Partial<ExtractionResult> = {}): ExtractionResult {
  return {
    entities: [],
    relationships: [],
    ...overrides,
  };
}

describe("upsertGraph", () => {
  it("early-returns for empty extraction (no prisma calls)", async () => {
    const prisma = createMockPrisma();
    const extraction = makeExtraction();

    await upsertGraph("user-1", extraction, prisma);

    expect(prisma.knowledgeEntity.upsert).not.toHaveBeenCalled();
    expect(prisma.knowledgeRelationship.findFirst).not.toHaveBeenCalled();
    expect(prisma.knowledgeRelationship.create).not.toHaveBeenCalled();
  });

  it("upserts each entity with correct composite key", async () => {
    const prisma = createMockPrisma();
    const extraction = makeExtraction({
      entities: [
        { type: "person", name: "Jordan Chen" },
        { type: "company", name: "Acme Corp" },
      ],
    });

    await upsertGraph("user-1", extraction, prisma);

    expect(prisma.knowledgeEntity.upsert).toHaveBeenCalledTimes(2);

    expect(prisma.knowledgeEntity.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId_type_name: { userId: "user-1", type: "person", name: "Jordan Chen" },
        },
        create: expect.objectContaining({ userId: "user-1", type: "person", name: "Jordan Chen" }),
      }),
    );

    expect(prisma.knowledgeEntity.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId_type_name: { userId: "user-1", type: "company", name: "Acme Corp" },
        },
        create: expect.objectContaining({ userId: "user-1", type: "company", name: "Acme Corp" }),
      }),
    );
  });

  it("creates new relationship when none exists", async () => {
    // findFirst returns null => no existing relationship
    const prisma = createMockPrisma();
    // Entity upsert returns different IDs for source vs target
    prisma.knowledgeEntity.upsert
      .mockResolvedValueOnce({ id: "ent-person-1" })
      .mockResolvedValueOnce({ id: "ent-company-1" });

    const extraction = makeExtraction({
      entities: [
        { type: "person", name: "Jordan Chen" },
        { type: "company", name: "Acme Corp" },
      ],
      relationships: [
        {
          sourceType: "person",
          sourceName: "Jordan Chen",
          relationship: "works_at",
          targetType: "company",
          targetName: "Acme Corp",
        },
      ],
    });

    await upsertGraph("user-1", extraction, prisma);

    expect(prisma.knowledgeRelationship.findFirst).toHaveBeenCalledOnce();
    expect(prisma.knowledgeRelationship.create).toHaveBeenCalledOnce();
    expect(prisma.knowledgeRelationship.update).not.toHaveBeenCalled();
  });

  it("increments weight on existing relationship", async () => {
    const prisma = createMockPrisma();
    prisma.knowledgeEntity.upsert
      .mockResolvedValueOnce({ id: "ent-person-1" })
      .mockResolvedValueOnce({ id: "ent-company-1" });
    // findFirst returns an existing relationship
    prisma.knowledgeRelationship.findFirst.mockResolvedValue({ id: "rel-existing-1" });

    const extraction = makeExtraction({
      entities: [
        { type: "person", name: "Jordan Chen" },
        { type: "company", name: "Acme Corp" },
      ],
      relationships: [
        {
          sourceType: "person",
          sourceName: "Jordan Chen",
          relationship: "works_at",
          targetType: "company",
          targetName: "Acme Corp",
        },
      ],
    });

    await upsertGraph("user-1", extraction, prisma);

    expect(prisma.knowledgeRelationship.update).toHaveBeenCalledOnce();
    expect(prisma.knowledgeRelationship.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "rel-existing-1" },
        data: expect.objectContaining({ weight: { increment: 0.1 } }),
      }),
    );
    expect(prisma.knowledgeRelationship.create).not.toHaveBeenCalled();
  });

  it("fires embedding when embeddingProvider given", async () => {
    const prisma = createMockPrisma();
    const embeddingProvider = {
      embed: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
    };

    const extraction = makeExtraction({
      entities: [{ type: "person", name: "Jordan Chen" }],
    });

    await upsertGraph("user-1", extraction, prisma, embeddingProvider as any);

    // Give async fire-and-forget a chance to run
    await new Promise((r) => setTimeout(r, 10));

    expect(embeddingProvider.embed).toHaveBeenCalledWith("Jordan Chen", "document");
    expect(prisma.$executeRaw).toHaveBeenCalled();
  });

  it("silently catches individual entity errors", async () => {
    const prisma = createMockPrisma();
    prisma.knowledgeEntity.upsert.mockRejectedValue(new Error("DB error"));

    const extraction = makeExtraction({
      entities: [{ type: "person", name: "Jordan Chen" }],
    });

    // Should not throw
    await expect(upsertGraph("user-1", extraction, prisma)).resolves.toBeUndefined();
  });

  it("silently catches individual relationship errors", async () => {
    const prisma = createMockPrisma();
    prisma.knowledgeEntity.upsert
      .mockResolvedValueOnce({ id: "ent-1" })
      .mockResolvedValueOnce({ id: "ent-2" });
    prisma.knowledgeRelationship.findFirst.mockRejectedValue(new Error("DB rel error"));

    const extraction = makeExtraction({
      entities: [
        { type: "person", name: "Jordan Chen" },
        { type: "company", name: "Acme Corp" },
      ],
      relationships: [
        {
          sourceType: "person",
          sourceName: "Jordan Chen",
          relationship: "works_at",
          targetType: "company",
          targetName: "Acme Corp",
        },
      ],
    });

    // Should not throw
    await expect(upsertGraph("user-1", extraction, prisma)).resolves.toBeUndefined();
  });

  it("skips relationships when entity lookup fails (missing from entityMap)", async () => {
    const prisma = createMockPrisma();
    // Both entities upsert fails, so entityMap stays empty
    prisma.knowledgeEntity.upsert.mockRejectedValue(new Error("entity upsert fail"));

    const extraction = makeExtraction({
      entities: [
        { type: "person", name: "Jordan Chen" },
        { type: "company", name: "Acme Corp" },
      ],
      relationships: [
        {
          sourceType: "person",
          sourceName: "Jordan Chen",
          relationship: "works_at",
          targetType: "company",
          targetName: "Acme Corp",
        },
      ],
    });

    await upsertGraph("user-1", extraction, prisma);

    // Relationship lookup should not have been called since entities weren't in the map
    expect(prisma.knowledgeRelationship.findFirst).not.toHaveBeenCalled();
    expect(prisma.knowledgeRelationship.create).not.toHaveBeenCalled();
  });
});
