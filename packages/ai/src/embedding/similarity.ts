import { AI_CONFIG } from "../config.js";

// --- Types ---

export interface SimilarityMatch {
  entityId: string;
  similarity: number;
}

export interface ClassifiedMatches {
  autoLinks: SimilarityMatch[];
  suggestions: SimilarityMatch[];
}

// --- Classification ---

/**
 * Classifies similarity matches into auto-links and suggestions based on thresholds.
 * - Above autoLinkThreshold (0.90) → autoLinks
 * - Between suggestThreshold (0.75) and autoLinkThreshold → suggestions
 * - Below suggestThreshold → discarded
 */
export function classifyMatches(matches: SimilarityMatch[]): ClassifiedMatches {
  const { autoLinkThreshold, suggestThreshold } = AI_CONFIG.embedding;
  const autoLinks: SimilarityMatch[] = [];
  const suggestions: SimilarityMatch[] = [];

  for (const match of matches) {
    if (match.similarity >= autoLinkThreshold) {
      autoLinks.push(match);
    } else if (match.similarity >= suggestThreshold) {
      suggestions.push(match);
    }
    // below suggestThreshold → discarded
  }

  return { autoLinks, suggestions };
}

// --- Similarity Queries ---

export interface FindSimilarOptions {
  targetEntityType?: string;
  limit?: number;
  excludeIds?: string[];
}

/**
 * Finds similar entities to the given entity by cosine similarity on chunk 0.
 * Uses a self-join on the Embedding table via pgvector's <=> operator.
 */
export async function findSimilarItems(
  userId: string,
  entityType: string,
  entityId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prisma: any,
  options: FindSimilarOptions = {}
): Promise<SimilarityMatch[]> {
  const { targetEntityType, limit = AI_CONFIG.embedding.searchResultLimit, excludeIds = [] } =
    options;

  // Load the source entity's chunk 0 embedding
  const sourceRows = await prisma.$queryRaw<Array<{ embedding: string }>>`
    SELECT embedding::text AS embedding
    FROM "Embedding"
    WHERE "userId" = ${userId}
      AND "entityType" = ${entityType}
      AND "entityId" = ${entityId}
      AND "chunkIndex" = 0
    LIMIT 1
  `;

  if (sourceRows.length === 0) return [];

  const vectorStr = sourceRows[0].embedding;

  // Build the query — find nearest neighbors, excluding the source entity itself
  // and any explicitly excluded IDs
  const allExcluded = [entityId, ...excludeIds];

  let rows: Array<{ entityId: string; similarity: number }>;

  if (targetEntityType != null) {
    rows = await prisma.$queryRaw<typeof rows>`
      SELECT * FROM (
        SELECT DISTINCT ON ("entityId")
          "entityId",
          1 - (embedding <=> ${vectorStr}::vector) AS similarity
        FROM "Embedding"
        WHERE "userId" = ${userId}
          AND "entityType" = ${targetEntityType}
          AND "entityId" != ALL(${allExcluded})
        ORDER BY "entityId", embedding <=> ${vectorStr}::vector ASC
      ) sub
      ORDER BY similarity DESC
      LIMIT ${limit}
    `;
  } else {
    rows = await prisma.$queryRaw<typeof rows>`
      SELECT * FROM (
        SELECT DISTINCT ON ("entityId")
          "entityId",
          1 - (embedding <=> ${vectorStr}::vector) AS similarity
        FROM "Embedding"
        WHERE "userId" = ${userId}
          AND "entityId" != ALL(${allExcluded})
        ORDER BY "entityId", embedding <=> ${vectorStr}::vector ASC
      ) sub
      ORDER BY similarity DESC
      LIMIT ${limit}
    `;
  }

  return rows.map((r) => ({ entityId: r.entityId, similarity: Number(r.similarity) }));
}

/**
 * Finds near-duplicate entities above the dupThreshold (0.85).
 */
export async function findDuplicates(
  userId: string,
  entityId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prisma: any
): Promise<SimilarityMatch[]> {
  // We need the entityType for the source entity — look it up from the Embedding table
  const sourceRows = await prisma.$queryRaw<Array<{ entityType: string }>>`
    SELECT "entityType"
    FROM "Embedding"
    WHERE "userId" = ${userId}
      AND "entityId" = ${entityId}
      AND "chunkIndex" = 0
    LIMIT 1
  `;

  if (sourceRows.length === 0) return [];

  const entityType: string = sourceRows[0].entityType;
  const { dupThreshold } = AI_CONFIG.embedding;

  const matches = await findSimilarItems(userId, entityType, entityId, prisma);
  return matches.filter((m) => m.similarity >= dupThreshold);
}

// --- List Suggestions ---

/**
 * Suggests up to 3 lists that an item might belong to, based on cosine similarity
 * between the item's embedding and each list's centroid (average embedding of active items).
 *
 * Executes a single SQL query that:
 * 1. Loads the target item's embedding
 * 2. Computes centroids for all lists with active items
 * 3. Ranks lists by cosine similarity to the item
 */
export async function suggestLists(
  userId: string,
  entityId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prisma: any
): Promise<Array<{ listId: string; listName: string; similarity: number }>> {
  const rows = await prisma.$queryRaw<
    Array<{ listId: string; listName: string; similarity: number }>
  >`
    WITH item_embedding AS (
      SELECT embedding
      FROM "Embedding"
      WHERE "userId" = ${userId}
        AND "entityType" = 'item'
        AND "entityId" = ${entityId}
        AND "chunkIndex" = 0
      LIMIT 1
    ),
    list_centroids AS (
      SELECT i."listId", AVG(e.embedding) AS centroid
      FROM "Embedding" e
      INNER JOIN "Item" i ON e."entityId" = i.id
      WHERE e."userId" = ${userId}
        AND e."entityType" = 'item'
        AND e."chunkIndex" = 0
        AND i.status = 'active'
        AND i."listId" IS NOT NULL
      GROUP BY i."listId"
    )
    SELECT
      lc."listId" AS "listId",
      l.name AS "listName",
      1 - ((SELECT embedding FROM item_embedding) <=> lc.centroid) AS similarity
    FROM list_centroids lc
    INNER JOIN "List" l ON l.id = lc."listId"
    CROSS JOIN item_embedding ie
    WHERE l."archivedAt" IS NULL
      AND 1 - (ie.embedding <=> lc.centroid) > 0.5
    ORDER BY similarity DESC
    LIMIT 3
  `;

  return rows.map((r: { listId: string; listName: string; similarity: number }) => ({
    listId: r.listId,
    listName: r.listName,
    similarity: Number(r.similarity),
  }));
}
