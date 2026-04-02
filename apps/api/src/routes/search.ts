import { Hono } from "hono";
import { authMiddleware, type AuthEnv } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";
import { getEmbeddingProvider } from "../lib/embedding-provider.js";
import { hybridSearch } from "@brett/ai";

const search = new Hono<AuthEnv>();

/**
 * GET /search?q=<query>&types=<comma-separated>&limit=<number>
 *
 * Hybrid search across items, calendar events, meeting notes, and scout findings.
 * Returns enriched results with entity metadata.
 */
search.get("/search", authMiddleware, async (c) => {
  const user = c.get("user");
  const q = c.req.query("q")?.trim();
  const typesParam = c.req.query("types");
  const limitParam = c.req.query("limit");

  if (!q || q.length < 2) {
    return c.json({ error: "Query must be at least 2 characters" }, 400);
  }

  const limit = Math.min(Math.max(parseInt(limitParam || "20", 10) || 20, 1), 50);
  const types = typesParam ? typesParam.split(",").map((t) => t.trim()).filter(Boolean) : null;

  const provider = getEmbeddingProvider();

  const results = await hybridSearch(user.id, q, types, provider, prisma, limit);

  // Batch-load entity metadata by type
  const itemIds = results.filter((r) => r.entityType === "item").map((r) => r.entityId);
  const eventIds = results.filter((r) => r.entityType === "calendar_event").map((r) => r.entityId);
  const meetingIds = results.filter((r) => r.entityType === "meeting_note").map((r) => r.entityId);
  const findingIds = results.filter((r) => r.entityType === "scout_finding").map((r) => r.entityId);

  const [items, events, meetings, findings] = await Promise.all([
    itemIds.length > 0
      ? prisma.item.findMany({
          where: { id: { in: itemIds }, userId: user.id },
          select: {
            id: true,
            title: true,
            status: true,
            type: true,
            contentType: true,
            dueDate: true,
            list: { select: { name: true } },
          },
        })
      : [],
    eventIds.length > 0
      ? prisma.calendarEvent.findMany({
          where: { id: { in: eventIds }, userId: user.id },
          select: { id: true, title: true, startTime: true, endTime: true },
        })
      : [],
    meetingIds.length > 0
      ? prisma.meetingNote.findMany({
          where: { id: { in: meetingIds }, userId: user.id },
          select: { id: true, title: true, meetingStartedAt: true },
        })
      : [],
    findingIds.length > 0
      ? prisma.scoutFinding.findMany({
          where: { id: { in: findingIds }, scout: { userId: user.id } },
          select: {
            id: true,
            title: true,
            scout: { select: { name: true } },
          },
        })
      : [],
  ]);

  const itemMap = new Map(items.map((i: any) => [i.id, i]));
  const eventMap = new Map(events.map((e: any) => [e.id, e]));
  const meetingMap = new Map(meetings.map((m: any) => [m.id, m]));
  const findingMap = new Map(findings.map((f: any) => [f.id, f]));

  const enriched = results.map((r) => {
    const base = {
      entityType: r.entityType,
      entityId: r.entityId,
      title: r.title,
      snippet: r.snippet,
      score: r.score,
      matchType: r.matchType,
      metadata: { ...r.metadata },
    };

    if (r.entityType === "item") {
      const item = itemMap.get(r.entityId);
      if (item) {
        base.title = base.title || item.title || "";
        base.metadata = {
          ...base.metadata,
          status: item.status,
          type: item.type,
          contentType: item.contentType,
          dueDate: item.dueDate?.toISOString() ?? null,
          listName: item.list?.name ?? null,
        };
      }
    } else if (r.entityType === "calendar_event") {
      const event = eventMap.get(r.entityId);
      if (event) {
        base.title = base.title || event.title || "";
        base.metadata = {
          ...base.metadata,
          startTime: event.startTime?.toISOString() ?? null,
          endTime: event.endTime?.toISOString() ?? null,
        };
      }
    } else if (r.entityType === "meeting_note") {
      const meeting = meetingMap.get(r.entityId);
      if (meeting) {
        base.title = base.title || meeting.title || "";
        base.metadata = {
          ...base.metadata,
          meetingDate: meeting.meetingStartedAt?.toISOString() ?? null,
        };
      }
    } else if (r.entityType === "scout_finding") {
      const finding = findingMap.get(r.entityId);
      if (finding) {
        base.title = base.title || finding.title || "";
        base.metadata = {
          ...base.metadata,
          scoutName: finding.scout?.name ?? null,
        };
      }
    }

    return base;
  });

  return c.json({ results: enriched });
});

export default search;
