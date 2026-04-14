import { Prisma } from "@brett/api-core";
import type { EmbeddingProvider } from "../providers/types.js";
import { AI_CONFIG } from "../config.js";

// --- Types ---

export interface RankedResult {
  entityType: string;
  entityId: string;
  title: string;
  snippet: string;
  rank: number;
}

/** Raw row returned by full-text search queries */
interface FtsRow {
  id: string;
  title: string;
  snippet: string;
  fts_rank: number;
}

export interface SearchResult {
  entityType: string;
  entityId: string;
  title: string;
  snippet: string;
  score: number;
  matchType: "keyword" | "semantic" | "both";
  metadata: Record<string, unknown>;
}

// --- RRF Fusion ---

const RRF_K = 60;

/**
 * Fuses keyword and vector result lists using Reciprocal Rank Fusion.
 * RRF score = sum of 1/(k + rank) across all lists where a result appears.
 */
export function fuseResults(
  keywordResults: RankedResult[],
  vectorResults: RankedResult[],
  limit: number
): SearchResult[] {
  const scores = new Map<
    string,
    { score: number; result: RankedResult; inKeyword: boolean; inVector: boolean }
  >();

  for (const r of keywordResults) {
    const key = `${r.entityType}:${r.entityId}`;
    const existing = scores.get(key);
    const add = 1 / (RRF_K + r.rank);
    if (existing) {
      existing.score += add;
      existing.inKeyword = true;
    } else {
      scores.set(key, { score: add, result: r, inKeyword: true, inVector: false });
    }
  }

  for (const r of vectorResults) {
    const key = `${r.entityType}:${r.entityId}`;
    const existing = scores.get(key);
    const add = 1 / (RRF_K + r.rank);
    if (existing) {
      existing.score += add;
      existing.inVector = true;
    } else {
      scores.set(key, { score: add, result: r, inKeyword: false, inVector: true });
    }
  }

  const sorted = Array.from(scores.values()).sort((a, b) => b.score - a.score);

  return sorted.slice(0, limit).map(({ score, result, inKeyword, inVector }) => {
    const matchType: SearchResult["matchType"] =
      inKeyword && inVector ? "both" : inKeyword ? "keyword" : "semantic";

    return {
      entityType: result.entityType,
      entityId: result.entityId,
      title: result.title,
      snippet: result.snippet,
      score,
      matchType,
      metadata: {},
    };
  });
}

// --- Valid Entity Types ---

export const VALID_ENTITY_TYPES = ["item", "calendar_event", "meeting_note", "scout_finding"] as const;

// --- Keyword Search (Postgres Full-Text Search) ---

/**
 * Runs full-text search across multiple entity tables using Postgres tsvector/tsquery.
 * Uses GIN-indexed generated columns and ts_rank_cd for BM25-like ranking.
 * Only searches entity types in the `types` array (or all if null).
 */
export async function keywordSearch(
  userId: string,
  query: string,
  types: string[] | null,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prisma: any,
  limit: number = AI_CONFIG.embedding.searchResultLimit
): Promise<RankedResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const activeTypes: string[] =
    types === null
      ? [...VALID_ENTITY_TYPES]
      : types.filter((t) => VALID_ENTITY_TYPES.includes(t as any));

  if (activeTypes.length === 0) return [];

  const allResults: Array<RankedResult & { ftsRank: number }> = [];

  // Weight array for ts_rank_cd: {D, C, B, A}
  // A=1.0 (title), B=0.6 (contentTitle), C=0.3 (description/body), D=0.1 (notes/location)
  const weights = "{0.1, 0.3, 0.6, 1.0}";

  if (activeTypes.includes("item")) {
    const rows = await prisma.$queryRaw<FtsRow[]>`
      SELECT
        "id",
        coalesce("title", '') AS "title",
        coalesce("notes", "description", '') AS "snippet",
        ts_rank_cd(${Prisma.raw(`'${weights}'::float4[]`)}, "search_vector", plainto_tsquery('english', ${trimmed})) AS "fts_rank"
      FROM "Item"
      WHERE "userId" = ${userId}
        AND "search_vector" @@ plainto_tsquery('english', ${trimmed})
      ORDER BY "fts_rank" DESC
      LIMIT ${limit}
    `;
    for (const row of rows) {
      allResults.push({
        entityType: "item",
        entityId: row.id,
        title: row.title,
        snippet: row.snippet,
        rank: 0,
        ftsRank: Number(row.fts_rank),
      });
    }
  }

  if (activeTypes.includes("calendar_event")) {
    const rows = await prisma.$queryRaw<FtsRow[]>`
      SELECT
        "id",
        coalesce("title", '') AS "title",
        coalesce("description", '') AS "snippet",
        ts_rank_cd(${Prisma.raw(`'${weights}'::float4[]`)}, "search_vector", plainto_tsquery('english', ${trimmed})) AS "fts_rank"
      FROM "CalendarEvent"
      WHERE "userId" = ${userId}
        AND "search_vector" @@ plainto_tsquery('english', ${trimmed})
      ORDER BY "fts_rank" DESC
      LIMIT ${limit}
    `;
    for (const row of rows) {
      allResults.push({
        entityType: "calendar_event",
        entityId: row.id,
        title: row.title,
        snippet: row.snippet,
        rank: 0,
        ftsRank: Number(row.fts_rank),
      });
    }
  }

  if (activeTypes.includes("meeting_note")) {
    const rows = await prisma.$queryRaw<FtsRow[]>`
      SELECT
        "id",
        coalesce("title", '') AS "title",
        coalesce("summary", '') AS "snippet",
        ts_rank_cd(${Prisma.raw(`'${weights}'::float4[]`)}, "search_vector", plainto_tsquery('english', ${trimmed})) AS "fts_rank"
      FROM "GranolaMeeting"
      WHERE "userId" = ${userId}
        AND "search_vector" @@ plainto_tsquery('english', ${trimmed})
      ORDER BY "fts_rank" DESC
      LIMIT ${limit}
    `;
    for (const row of rows) {
      allResults.push({
        entityType: "meeting_note",
        entityId: row.id,
        title: row.title,
        snippet: row.snippet,
        rank: 0,
        ftsRank: Number(row.fts_rank),
      });
    }
  }

  if (activeTypes.includes("scout_finding")) {
    // ScoutFinding doesn't have userId directly — JOIN through Scout table
    const rows = await prisma.$queryRaw<FtsRow[]>`
      SELECT
        sf."id",
        coalesce(sf."title", '') AS "title",
        coalesce(sf."description", '') AS "snippet",
        ts_rank_cd(${Prisma.raw(`'${weights}'::float4[]`)}, sf."search_vector", plainto_tsquery('english', ${trimmed})) AS "fts_rank"
      FROM "ScoutFinding" sf
      JOIN "Scout" s ON sf."scoutId" = s."id"
      WHERE s."userId" = ${userId}
        AND sf."search_vector" @@ plainto_tsquery('english', ${trimmed})
      ORDER BY "fts_rank" DESC
      LIMIT ${limit}
    `;
    for (const row of rows) {
      allResults.push({
        entityType: "scout_finding",
        entityId: row.id,
        title: row.title,
        snippet: row.snippet,
        rank: 0,
        ftsRank: Number(row.fts_rank),
      });
    }
  }

  // Sort by fts_rank (descending), then assign 1-based ranks for RRF fusion
  allResults.sort((a, b) => b.ftsRank - a.ftsRank);
  return allResults.slice(0, limit).map((r, i) => ({
    entityType: r.entityType,
    entityId: r.entityId,
    title: r.title,
    snippet: r.snippet,
    rank: i + 1,
  }));
}

// --- Vector Search ---

/**
 * Embeds the query and finds similar entities via cosine similarity on the Embedding table.
 * Deduplicates by entityId — keeps the highest similarity chunk per entity.
 */
export async function vectorSearch(
  userId: string,
  query: string,
  types: string[] | null,
  provider: EmbeddingProvider,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prisma: any,
  limit = 30
): Promise<RankedResult[]> {
  // Filter types to only valid values to prevent SQL injection
  const safeTypes = types
    ? types.filter((t): t is string => VALID_ENTITY_TYPES.includes(t as any))
    : null;

  // If types were provided but none survived validation, return empty
  if (safeTypes !== null && safeTypes.length === 0) {
    return [];
  }

  const queryVector = await provider.embed(query, "query");
  const vectorStr = `[${queryVector.join(",")}]`;

  let rows: Array<{
    entityType: string;
    entityId: string;
    chunkText: string;
    similarity: number;
  }>;

  if (safeTypes !== null && safeTypes.length > 0) {
    // Use Prisma.join() so each type becomes a separate parameterized value in the IN clause.
    // Plain string interpolation inside $queryRaw would be sent as a single parameter, breaking the query.
    const typeParams = Prisma.join(safeTypes);
    rows = await prisma.$queryRaw<typeof rows>`
      SELECT * FROM (
        SELECT DISTINCT ON ("entityType", "entityId")
          "entityType",
          "entityId",
          "chunkText",
          1 - (embedding <=> ${vectorStr}::vector) AS similarity
        FROM "Embedding"
        WHERE "userId" = ${userId}
          AND "entityType" IN (${typeParams})
        ORDER BY "entityType", "entityId", embedding <=> ${vectorStr}::vector ASC
      ) sub
      ORDER BY similarity DESC
      LIMIT ${limit}
    `;
  } else {
    rows = await prisma.$queryRaw<typeof rows>`
      SELECT * FROM (
        SELECT DISTINCT ON ("entityType", "entityId")
          "entityType",
          "entityId",
          "chunkText",
          1 - (embedding <=> ${vectorStr}::vector) AS similarity
        FROM "Embedding"
        WHERE "userId" = ${userId}
        ORDER BY "entityType", "entityId", embedding <=> ${vectorStr}::vector ASC
      ) sub
      ORDER BY similarity DESC
      LIMIT ${limit}
    `;
  }

  // Rows are already sorted by similarity DESC and limited by the query
  const sorted = rows;

  return sorted.map((row, i) => ({
    entityType: row.entityType,
    entityId: row.entityId,
    title: "",
    snippet: row.chunkText,
    rank: i + 1,
  }));
}

// --- Hybrid Search ---

/**
 * Runs keyword and vector searches in parallel, then fuses results via RRF.
 * Falls back to keyword-only if provider is null.
 */
export async function hybridSearch(
  userId: string,
  query: string,
  types: string[] | null,
  provider: EmbeddingProvider | null,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prisma: any,
  limit: number
): Promise<SearchResult[]> {
  if (provider === null) {
    const kwResults = await keywordSearch(userId, query, types, prisma, limit);
    return kwResults.map((r) => ({
      entityType: r.entityType,
      entityId: r.entityId,
      title: r.title,
      snippet: r.snippet,
      score: 1 / (RRF_K + r.rank),
      matchType: "keyword" as const,
      metadata: {},
    }));
  }

  const [kwResults, vecResults] = await Promise.all([
    keywordSearch(userId, query, types, prisma, limit),
    vectorSearch(userId, query, types, provider, prisma, limit).catch((err) => {
      console.error("[embedding] Vector search failed, falling back to keyword-only:", err.message);
      return [] as RankedResult[];
    }),
  ]);

  return fuseResults(kwResults, vecResults, limit);
}
