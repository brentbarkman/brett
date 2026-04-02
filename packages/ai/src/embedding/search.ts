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
 * Runs ILIKE search across multiple entity tables.
 * Only searches entity types in the `types` array (or all if null).
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

  const allResults: RankedResult[] = [];

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
      allResults.push({
        entityType: "item",
        entityId: item.id,
        title: item.title ?? "",
        snippet: item.notes ?? item.description ?? "",
        rank: 0, // will be assigned below
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
      });
    }
  }

  // Assign ranks (1-based)
  return allResults.slice(0, limit).map((r, i) => ({ ...r, rank: i + 1 }));
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
  const queryVector = await provider.embed(query, "query");
  const vectorStr = `[${queryVector.join(",")}]`;

  let rows: Array<{
    entityType: string;
    entityId: string;
    chunkText: string;
    similarity: number;
  }>;

  if (types !== null && types.length > 0) {
    // Entity types are a fixed set of known strings, safe to interpolate
    const typeList = types.map((t) => `'${t}'`).join(", ");
    rows = await prisma.$queryRaw<typeof rows>`
      SELECT DISTINCT ON ("entityType", "entityId")
        "entityType",
        "entityId",
        "chunkText",
        1 - (embedding <=> ${vectorStr}::vector) AS similarity
      FROM "Embedding"
      WHERE "userId" = ${userId}
        AND "entityType" IN (${typeList})
      ORDER BY "entityType", "entityId", similarity DESC
    `;
  } else {
    rows = await prisma.$queryRaw<typeof rows>`
      SELECT DISTINCT ON ("entityType", "entityId")
        "entityType",
        "entityId",
        "chunkText",
        1 - (embedding <=> ${vectorStr}::vector) AS similarity
      FROM "Embedding"
      WHERE "userId" = ${userId}
      ORDER BY "entityType", "entityId", similarity DESC
    `;
  }

  // Sort by similarity descending and assign ranks
  const sorted = rows
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);

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
    vectorSearch(userId, query, types, provider, prisma, limit),
  ]);

  return fuseResults(kwResults, vecResults, limit);
}
