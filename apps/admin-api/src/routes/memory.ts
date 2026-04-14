import { Hono } from "hono";
import { prisma } from "@brett/api-core";
import type { AuthEnv } from "@brett/api-core";
import { estimateCost } from "../lib/pricing.js";

export const memory = new Hono<AuthEnv>();

memory.get("/stats", async (c) => {
  const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [
    // Knowledge Graph
    totalEntities,
    totalRelationships,
    entitiesByType,
    entitiesLast30d,
    relationshipsLast30d,

    // Embedding coverage
    totalItems,
    embeddedItems,
    totalEvents,
    embeddedEvents,
    totalMeetingNotes,
    embeddedMeetingNotes,

    // UserFacts
    activeFacts,
    expiredFacts,
    factsLast30d,

    // AI extraction spend (graph_extraction + fact_extraction sources)
    extractionTokens,
  ] = await Promise.all([
    // Graph
    prisma.$queryRaw<[{ count: bigint }]>`SELECT COUNT(*)::bigint AS count FROM "KnowledgeEntity"`.then(r => Number(r[0].count)),
    prisma.$queryRaw<[{ count: bigint }]>`SELECT COUNT(*)::bigint AS count FROM "KnowledgeRelationship" WHERE "validUntil" IS NULL`.then(r => Number(r[0].count)),
    prisma.$queryRaw<Array<{ type: string; count: bigint }>>`
      SELECT type, COUNT(*)::bigint AS count FROM "KnowledgeEntity" GROUP BY type ORDER BY count DESC
    `.then(rows => rows.map(r => ({ type: r.type, count: Number(r.count) }))),
    prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*)::bigint AS count FROM "KnowledgeEntity" WHERE "createdAt" >= ${since30d}
    `.then(r => Number(r[0].count)),
    prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*)::bigint AS count FROM "KnowledgeRelationship" WHERE "createdAt" >= ${since30d}
    `.then(r => Number(r[0].count)),

    // Embedding coverage — count items vs items with embeddings
    prisma.item.count(),
    prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(DISTINCT "entityId")::bigint AS count FROM "Embedding" WHERE "entityType" = 'item'
    `.then(r => Number(r[0].count)),
    prisma.calendarEvent.count(),
    prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(DISTINCT "entityId")::bigint AS count FROM "Embedding" WHERE "entityType" = 'calendar_event'
    `.then(r => Number(r[0].count)),
    prisma.$queryRaw<[{ count: bigint }]>`SELECT COUNT(*)::bigint AS count FROM "GranolaMeeting"`.then(r => Number(r[0].count)),
    prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(DISTINCT "entityId")::bigint AS count FROM "Embedding" WHERE "entityType" = 'meeting_note'
    `.then(r => Number(r[0].count)),

    // UserFacts
    prisma.userFact.count({ where: { validUntil: null } }),
    prisma.userFact.count({ where: { validUntil: { not: null } } }),
    prisma.userFact.count({ where: { createdAt: { gte: since30d } } }),

    // Extraction spend
    prisma.aIUsageLog.groupBy({
      by: ["model", "source"],
      where: { source: { in: ["graph_extraction", "fact_extraction", "entity_fact_extraction"] } },
      _sum: { inputTokens: true, outputTokens: true },
      _count: true,
    }),
  ]);

  // Compute extraction costs
  let extractionSpendUsd = 0;
  let extractionCalls = 0;
  const bySource: Record<string, { calls: number; tokens: number; costUsd: number }> = {};

  for (const group of extractionTokens) {
    const input = group._sum.inputTokens ?? 0;
    const output = group._sum.outputTokens ?? 0;
    const cost = estimateCost(group.model, input, output);
    extractionSpendUsd += cost;
    extractionCalls += group._count;

    const source = group.source ?? "unknown";
    if (!bySource[source]) bySource[source] = { calls: 0, tokens: 0, costUsd: 0 };
    bySource[source].calls += group._count;
    bySource[source].tokens += input + output;
    bySource[source].costUsd += cost;
  }

  // Embedding coverage percentages
  const itemCoverage = totalItems > 0 ? embeddedItems / totalItems : 1;
  const eventCoverage = totalEvents > 0 ? embeddedEvents / totalEvents : 1;
  const meetingCoverage = totalMeetingNotes > 0 ? embeddedMeetingNotes / totalMeetingNotes : 1;

  return c.json({
    graph: {
      totalEntities,
      totalRelationships,
      entitiesByType,
      newEntities30d: entitiesLast30d,
      newRelationships30d: relationshipsLast30d,
    },
    embeddings: {
      items: { total: totalItems, embedded: embeddedItems, coverage: Math.round(itemCoverage * 1000) / 10 },
      calendarEvents: { total: totalEvents, embedded: embeddedEvents, coverage: Math.round(eventCoverage * 1000) / 10 },
      meetingNotes: { total: totalMeetingNotes, embedded: embeddedMeetingNotes, coverage: Math.round(meetingCoverage * 1000) / 10 },
    },
    facts: {
      active: activeFacts,
      expired: expiredFacts,
      newLast30d: factsLast30d,
    },
    extraction: {
      totalCalls: extractionCalls,
      totalSpendUsd: Math.round(extractionSpendUsd * 100) / 100,
      bySource,
    },
  });
});

/**
 * Per-user breakdown — top users by graph size and fact count.
 */
memory.get("/users", async (c) => {
  const limit = Math.min(parseInt(c.req.query("limit") ?? "20"), 100);

  const topByEntities = await prisma.$queryRaw<
    Array<{ userId: string; name: string; email: string; entityCount: bigint; relationshipCount: bigint; factCount: bigint }>
  >`
    SELECT
      u.id AS "userId",
      u.name,
      u.email,
      COALESCE(ke.cnt, 0)::bigint AS "entityCount",
      COALESCE(kr.cnt, 0)::bigint AS "relationshipCount",
      COALESCE(uf.cnt, 0)::bigint AS "factCount"
    FROM "user" u
    LEFT JOIN (SELECT "userId", COUNT(*) AS cnt FROM "KnowledgeEntity" GROUP BY "userId") ke ON ke."userId" = u.id
    LEFT JOIN (SELECT "userId", COUNT(*) AS cnt FROM "KnowledgeRelationship" WHERE "validUntil" IS NULL GROUP BY "userId") kr ON kr."userId" = u.id
    LEFT JOIN (SELECT "userId", COUNT(*) AS cnt FROM "UserFact" WHERE "validUntil" IS NULL GROUP BY "userId") uf ON uf."userId" = u.id
    ORDER BY COALESCE(ke.cnt, 0) + COALESCE(uf.cnt, 0) DESC
    LIMIT ${limit}
  `;

  return c.json({
    users: topByEntities.map((u) => ({
      userId: u.userId,
      name: u.name,
      email: u.email,
      entityCount: Number(u.entityCount),
      relationshipCount: Number(u.relationshipCount),
      factCount: Number(u.factCount),
    })),
  });
});
