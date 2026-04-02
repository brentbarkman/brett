import { Prisma } from "@prisma/client";
import type { EmbeddingProvider } from "../providers/types.js";

// --- Types ---

export interface RankedResult {
  entityType: string;
  entityId: string;
  title: string;
  snippet: string;
  rank: number;
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

// --- Keyword Search ---

const KEYWORD_ENTITY_TYPES = ["item", "calendar_event", "meeting_note", "scout_finding"] as const;
type KeywordEntityType = (typeof KEYWORD_ENTITY_TYPES)[number];

/**
 * Simple relevance score for keyword matches.
 * Title matches score higher than body matches; exact word boundary matches score higher than substring.
 */
function keywordRelevance(title: string, snippet: string, query: string): number {
  const lower = query.toLowerCase();
  const titleLower = (title ?? "").toLowerCase();
  const snippetLower = (snippet ?? "").toLowerCase();

  let score = 0;
  // Title contains query → strong signal
  if (titleLower.includes(lower)) {
    score += 10;
    // Exact title match or starts-with → even stronger
    if (titleLower === lower || titleLower.startsWith(lower + " ") || titleLower.startsWith(lower + ":")) {
      score += 5;
    }
  }
  // Body/snippet contains query
  if (snippetLower.includes(lower)) {
    score += 3;
  }
  // Bonus: shorter titles with match are more relevant (precision)
  if (titleLower.includes(lower) && title.length < 80) {
    score += 2;
  }
  return score;
}

/**
 * Runs ILIKE search across multiple entity tables.
 * Only searches entity types in the `types` array (or all if null).
 * Results are ranked by relevance (title matches > body matches).
 */
export async function keywordSearch(
  userId: string,
  query: string,
  types: string[] | null,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prisma: any,
  limit = 30
): Promise<RankedResult[]> {
  const activeTypes: KeywordEntityType[] =
    types === null
      ? [...KEYWORD_ENTITY_TYPES]
      : (types.filter((t) => KEYWORD_ENTITY_TYPES.includes(t as KeywordEntityType)) as KeywordEntityType[]);

  const allResults: Array<RankedResult & { relevance: number }> = [];

  if (activeTypes.includes("item")) {
    const items = await prisma.item.findMany({
      where: {
        userId,
        OR: [
          { title: { contains: query, mode: "insensitive" } },
          { notes: { contains: query, mode: "insensitive" } },
          { contentTitle: { contains: query, mode: "insensitive" } },
          { description: { contains: query, mode: "insensitive" } },
        ],
      },
      select: { id: true, title: true, notes: true, description: true },
      take: limit,
    });

    for (const item of items) {
      const snippet = item.notes ?? item.description ?? "";
      allResults.push({
        entityType: "item",
        entityId: item.id,
        title: item.title ?? "",
        snippet,
        rank: 0,
        relevance: keywordRelevance(item.title ?? "", snippet, query),
      });
    }
  }

  if (activeTypes.includes("calendar_event")) {
    const events = await prisma.calendarEvent.findMany({
      where: {
        userId,
        OR: [
          { title: { contains: query, mode: "insensitive" } },
          { description: { contains: query, mode: "insensitive" } },
        ],
      },
      select: { id: true, title: true, description: true },
      take: limit,
    });

    for (const event of events) {
      allResults.push({
        entityType: "calendar_event",
        entityId: event.id,
        title: event.title ?? "",
        snippet: event.description ?? "",
        rank: 0,
        relevance: keywordRelevance(event.title ?? "", event.description ?? "", query),
      });
    }
  }

  if (activeTypes.includes("meeting_note")) {
    const notes = await prisma.meetingNote.findMany({
      where: {
        userId,
        OR: [
          { title: { contains: query, mode: "insensitive" } },
          { summary: { contains: query, mode: "insensitive" } },
        ],
      },
      select: { id: true, title: true, summary: true },
      take: limit,
    });

    for (const note of notes) {
      allResults.push({
        entityType: "meeting_note",
        entityId: note.id,
        title: note.title ?? "",
        snippet: note.summary ?? "",
        rank: 0,
        relevance: keywordRelevance(note.title ?? "", note.summary ?? "", query),
      });
    }
  }

  if (activeTypes.includes("scout_finding")) {
    const findings = await prisma.scoutFinding.findMany({
      where: {
        scout: { userId },
        OR: [
          { title: { contains: query, mode: "insensitive" } },
          { description: { contains: query, mode: "insensitive" } },
        ],
      },
      select: { id: true, title: true, description: true },
      take: limit,
    });

    for (const finding of findings) {
      allResults.push({
        entityType: "scout_finding",
        entityId: finding.id,
        title: finding.title ?? "",
        snippet: finding.description ?? "",
        rank: 0,
        relevance: keywordRelevance(finding.title ?? "", finding.description ?? "", query),
      });
    }
  }

  // Sort by relevance (descending), then assign 1-based ranks for RRF fusion
  allResults.sort((a, b) => b.relevance - a.relevance);
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
export const VALID_ENTITY_TYPES = ["item", "calendar_event", "meeting_note", "scout_finding"] as const;

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
