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
      SELECT DISTINCT ON ("entityId")
        "entityId",
        1 - (embedding <=> ${vectorStr}::vector) AS similarity
      FROM "Embedding"
      WHERE "userId" = ${userId}
        AND "entityType" = ${targetEntityType}
        AND "entityId" != ALL(${allExcluded})
      ORDER BY "entityId", similarity DESC
      LIMIT ${limit}
    `;
  } else {
    rows = await prisma.$queryRaw<typeof rows>`
      SELECT DISTINCT ON ("entityId")
        "entityId",
        1 - (embedding <=> ${vectorStr}::vector) AS similarity
      FROM "Embedding"
      WHERE "userId" = ${userId}
        AND "entityId" != ALL(${allExcluded})
      ORDER BY "entityId", similarity DESC
      LIMIT ${limit}
    `;
  }

  // Sort by similarity descending (DISTINCT ON ordering is by entityId, not similarity)
  return rows
    .map((r) => ({ entityId: r.entityId, similarity: Number(r.similarity) }))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);
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

// --- List Centroids ---

/**
 * Computes the average embedding (centroid) of all active items in a list.
 * Returns the centroid as a vector string, or null if the list has no embeddings.
 */
export async function getListCentroid(
  listId: string,
  userId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prisma: any
): Promise<string | null> {
  const rows = await prisma.$queryRaw<Array<{ centroid: string | null }>>`
    SELECT AVG(e.embedding)::text AS centroid
    FROM "Embedding" e
    INNER JOIN "ItemList" il ON il."itemId" = e."entityId"
    WHERE il."listId" = ${listId}
      AND e."userId" = ${userId}
      AND e."entityType" = 'item'
      AND e."chunkIndex" = 0
  `;

  return rows[0]?.centroid ?? null;
}

/**
 * Suggests up to 3 lists that an item might belong to, based on cosine similarity
 * between the item's embedding and each list's centroid.
 */
export async function suggestLists(
  userId: string,
  entityId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prisma: any
): Promise<Array<{ listId: string; listName: string; similarity: number }>> {
  // Load the item's embedding
  const sourceRows = await prisma.$queryRaw<Array<{ embedding: string }>>`
    SELECT embedding::text AS embedding
    FROM "Embedding"
    WHERE "userId" = ${userId}
      AND "entityId" = ${entityId}
      AND "chunkIndex" = 0
    LIMIT 1
  `;

  if (sourceRows.length === 0) return [];

  const vectorStr = sourceRows[0].embedding;

  // Get all lists owned by this user
  const lists = await prisma.list.findMany({
    where: { userId },
    select: { id: true, name: true },
  });

  if (lists.length === 0) return [];

  // Compute similarity against each list's centroid
  const suggestions: Array<{ listId: string; listName: string; similarity: number }> = [];

  for (const list of lists) {
    const centroid = await getListCentroid(list.id, userId, prisma);
    if (centroid === null) continue;

    const simRows = await prisma.$queryRaw<Array<{ similarity: number }>>`
      SELECT 1 - (${vectorStr}::vector <=> ${centroid}::vector) AS similarity
    `;

    const similarity = Number(simRows[0]?.similarity ?? 0);
    if (similarity >= 0.5) {
      suggestions.push({ listId: list.id, listName: list.name, similarity });
    }
  }

  // Return top 3 by similarity
  return suggestions.sort((a, b) => b.similarity - a.similarity).slice(0, 3);
}
