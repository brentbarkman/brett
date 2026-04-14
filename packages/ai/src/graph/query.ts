import type { EmbeddingProvider } from "../providers/types.js";

interface GraphEntity {
  id: string;
  type: string;
  name: string;
  properties: Record<string, unknown>;
}

interface GraphRelationship {
  id: string;
  type: string;
  weight: number;
  source: GraphEntity;
  target: GraphEntity;
}

/**
 * Recursive CTE traversal from a starting entity.
 * Uses a visited-node array for cycle detection.
 * userId is enforced on ALL entity JOINs for multi-tenant security.
 */
export async function findConnected(
  userId: string,
  entityId: string,
  prisma: any, // ExtendedPrismaClient loses types through $extends
  maxHops: number = 2,
  limit: number = 20,
): Promise<GraphRelationship[]> {
  const results = await prisma.$queryRaw`
    WITH RECURSIVE graph AS (
      SELECT
        r.id AS "relId", r.relationship AS "relType", r.weight,
        s.id AS "sourceId", s.type AS "sourceType", s.name AS "sourceName", s.properties AS "sourceProps",
        t.id AS "targetId", t.type AS "targetType", t.name AS "targetName", t.properties AS "targetProps",
        1 AS depth,
        ARRAY[${entityId}, CASE WHEN r."sourceId" = ${entityId} THEN r."targetId" ELSE r."sourceId" END] AS visited
      FROM "KnowledgeRelationship" r
      JOIN "KnowledgeEntity" s ON r."sourceId" = s.id AND s."userId" = ${userId}
      JOIN "KnowledgeEntity" t ON r."targetId" = t.id AND t."userId" = ${userId}
      WHERE r."userId" = ${userId}
        AND r."validUntil" IS NULL
        AND (r."sourceId" = ${entityId} OR r."targetId" = ${entityId})
      UNION ALL
      SELECT
        r2.id, r2.relationship, r2.weight,
        s2.id, s2.type, s2.name, s2.properties,
        t2.id, t2.type, t2.name, t2.properties,
        g.depth + 1,
        g.visited || CASE WHEN r2."sourceId" = ANY(g.visited) THEN r2."targetId" ELSE r2."sourceId" END
      FROM graph g
      JOIN "KnowledgeRelationship" r2 ON (
        r2."sourceId" = g."targetId" OR r2."targetId" = g."sourceId"
      )
      JOIN "KnowledgeEntity" s2 ON r2."sourceId" = s2.id AND s2."userId" = ${userId}
      JOIN "KnowledgeEntity" t2 ON r2."targetId" = t2.id AND t2."userId" = ${userId}
      WHERE r2."userId" = ${userId}
        AND r2."validUntil" IS NULL
        AND g.depth < ${maxHops}
        AND NOT (
          CASE WHEN r2."sourceId" = ANY(g.visited) THEN r2."targetId" ELSE r2."sourceId" END
        ) = ANY(g.visited)
    )
    SELECT DISTINCT ON ("relId") "relId", "relType", weight,
      "sourceId", "sourceType", "sourceName", "sourceProps",
      "targetId", "targetType", "targetName", "targetProps",
      depth
    FROM graph
    ORDER BY "relId", depth ASC
    LIMIT ${limit}
  `;

  return (results as any[]).map((r) => ({
    id: r.relId,
    type: r.relType,
    weight: Number(r.weight),
    source: {
      id: r.sourceId,
      type: r.sourceType,
      name: r.sourceName,
      properties: r.sourceProps as Record<string, unknown>,
    },
    target: {
      id: r.targetId,
      type: r.targetType,
      name: r.targetName,
      properties: r.targetProps as Record<string, unknown>,
    },
  }));
}

/**
 * Vector similarity search on KnowledgeEntity embeddings.
 */
export async function findEntitiesBySimilarity(
  userId: string,
  query: string,
  provider: EmbeddingProvider,
  prisma: any,
  limit: number = 10,
): Promise<Array<GraphEntity & { similarity: number }>> {
  const queryEmbedding = await provider.embed(query, "query");
  const vectorStr = `[${queryEmbedding.join(",")}]`;

  const results = await prisma.$queryRaw`
    SELECT id, type, name, properties,
      1 - (embedding <=> ${vectorStr}::vector) AS similarity
    FROM "KnowledgeEntity"
    WHERE "userId" = ${userId}
      AND embedding IS NOT NULL
    ORDER BY embedding <=> ${vectorStr}::vector ASC
    LIMIT ${limit}
  `;

  return (results as any[]).map((r) => ({
    id: r.id,
    type: r.type,
    name: r.name,
    properties: r.properties as Record<string, unknown>,
    similarity: Number(r.similarity),
  }));
}

/**
 * Build a string context of graph relationships for AI prompts.
 * Fetches 1-hop connections for each entity and deduplicates.
 */
export async function buildGraphContext(
  userId: string,
  entityIds: string[],
  prisma: any,
): Promise<string> {
  if (entityIds.length === 0) return "";

  const relationships: GraphRelationship[] = [];
  for (const id of entityIds.slice(0, 5)) {
    const connected = await findConnected(userId, id, prisma, 1, 10);
    relationships.push(...connected);
  }

  if (relationships.length === 0) return "";

  const seen = new Set<string>();
  const unique = relationships.filter((r) => {
    if (seen.has(r.id)) return false;
    seen.add(r.id);
    return true;
  });

  return unique
    .map(
      (r) =>
        `${r.source.name} [${r.source.type}] —${r.type}→ ${r.target.name} [${r.target.type}]`,
    )
    .join("\n");
}
