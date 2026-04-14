import type { ExtendedPrismaClient } from "@brett/api-core";
import type { EmbeddingProvider } from "../providers/types.js";
import type { ExtractionResult } from "./types.js";

export async function upsertGraph(
  userId: string,
  extraction: ExtractionResult,
  prisma: ExtendedPrismaClient,
  embeddingProvider?: EmbeddingProvider | null,
  sourceContext?: { type: string; entityId: string },
): Promise<void> {
  if (extraction.entities.length === 0 && extraction.relationships.length === 0) return;

  const entityMap = new Map<string, string>();

  for (const entity of extraction.entities) {
    const key = `${entity.type}:${entity.name}`;
    try {
      const upserted = await prisma.knowledgeEntity.upsert({
        where: {
          userId_type_name: { userId, type: entity.type, name: entity.name },
        },
        create: {
          userId,
          type: entity.type,
          name: entity.name,
          properties: entity.properties ?? {},
        },
        update: {
          properties: entity.properties ?? {},
        },
      });
      entityMap.set(key, upserted.id);

      if (embeddingProvider) {
        embedEntityNode(upserted.id, entity.name, embeddingProvider, prisma).catch((err) =>
          console.error("[graph-embed]", err.message),
        );
      }
    } catch {
      // Silent fail on individual entity upserts
    }
  }

  for (const rel of extraction.relationships) {
    const sourceKey = `${rel.sourceType}:${rel.sourceName}`;
    const targetKey = `${rel.targetType}:${rel.targetName}`;
    const sourceId = entityMap.get(sourceKey);
    const targetId = entityMap.get(targetKey);
    if (!sourceId || !targetId) continue;

    try {
      const existing = await prisma.knowledgeRelationship.findFirst({
        where: {
          userId,
          sourceId,
          targetId,
          relationship: rel.relationship,
          validUntil: null,
        },
      });

      if (existing) {
        await prisma.knowledgeRelationship.update({
          where: { id: existing.id },
          data: { weight: { increment: 0.1 }, updatedAt: new Date() },
        });
      } else {
        await prisma.knowledgeRelationship.create({
          data: {
            userId,
            sourceId,
            targetId,
            relationship: rel.relationship,
            sourceType: sourceContext?.type,
            provenanceEntityId: sourceContext?.entityId,
            validFrom: new Date(),
          },
        });
      }
    } catch {
      // Silent fail on individual relationship errors
    }
  }
}

async function embedEntityNode(
  entityId: string,
  name: string,
  provider: EmbeddingProvider,
  prisma: ExtendedPrismaClient,
): Promise<void> {
  const embedding = await provider.embed(name, "document");
  const vectorStr = `[${embedding.join(",")}]`;
  await prisma.$executeRaw`
    UPDATE "KnowledgeEntity"
    SET embedding = ${vectorStr}::vector
    WHERE id = ${entityId}
  `;
}
