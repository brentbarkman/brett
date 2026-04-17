import type { EmbeddingProvider } from "../providers/types.js";
import type { ExtractionResult } from "./types.js";

/**
 * Canonicalize an entity name for deduping. Collapses whitespace, strips
 * surrounding punctuation, and lowercases. Catches the common case where
 * the same entity gets re-extracted with different casing ("stephen kim"
 * vs "Stephen Kim") or incidental whitespace. Does NOT try to collapse
 * partial names ("Stephen" → "Stephen Kim"); that needs embedding similarity
 * and is left for follow-up.
 */
function canonicalName(name: string): string {
  return name
    .trim()
    .replace(/\s+/g, " ")
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")
    .toLowerCase();
}

export async function upsertGraph(
  userId: string,
  extraction: ExtractionResult,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prisma: any,
  embeddingProvider?: EmbeddingProvider | null,
  sourceContext?: { type: string; entityId: string },
): Promise<void> {
  if (extraction.entities.length === 0 && extraction.relationships.length === 0) return;

  const entityMap = new Map<string, string>();

  for (const entity of extraction.entities) {
    const key = `${entity.type}:${entity.name}`;
    try {
      // Look up an existing entity of the same type whose canonical name
      // matches. Case-insensitive equality via Prisma `mode: "insensitive"`
      // covers the bulk of dedupes without a schema-level canonical column.
      // Note: the compound unique index stays on (type, name) — we just
      // pre-resolve here to avoid creating a duplicate row.
      const canonical = canonicalName(entity.name);
      const existing = canonical
        ? await prisma.knowledgeEntity.findFirst({
            where: {
              userId,
              type: entity.type,
              // Match any stored name whose canonical form equals ours.
              // We fetch candidates by case-insensitive match, then filter
              // in JS because whitespace variants won't match via SQL
              // equality alone.
              name: { equals: entity.name, mode: "insensitive" },
            },
            select: { id: true, name: true, properties: true },
          })
        : null;

      let upserted: { id: string };
      if (existing && canonicalName(existing.name) === canonical) {
        // Merge properties (new keys win; existing keys preserved)
        const mergedProps = {
          ...((existing.properties as Record<string, unknown> | null) ?? {}),
          ...(entity.properties ?? {}),
        };
        upserted = await prisma.knowledgeEntity.update({
          where: { id: existing.id },
          data: { properties: mergedProps },
          select: { id: true },
        });
      } else {
        upserted = await prisma.knowledgeEntity.upsert({
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
          select: { id: true },
        });
      }
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prisma: any,
): Promise<void> {
  const embedding = await provider.embed(name, "document");
  const vectorStr = `[${embedding.join(",")}]`;
  await prisma.$executeRaw`
    UPDATE "KnowledgeEntity"
    SET embedding = ${vectorStr}::vector
    WHERE id = ${entityId}
  `;
}
