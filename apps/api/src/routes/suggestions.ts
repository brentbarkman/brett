import { Hono } from "hono";
import { authMiddleware, type AuthEnv } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";
import { findSimilarItems, classifyMatches, suggestLists, AI_CONFIG } from "@brett/ai";

const suggestions = new Hono<AuthEnv>();
suggestions.use("*", authMiddleware);

// GET /things/:id/suggestions — Related item suggestions
suggestions.get("/things/:id/suggestions", async (c) => {
  const user = c.get("user");
  const itemId = c.req.param("id");

  const item = await prisma.item.findFirst({ where: { id: itemId, userId: user.id } });
  if (!item) return c.json({ error: "Not found" }, 404);

  try {
    // Get already-linked item IDs to exclude
    const existingLinks = await prisma.itemLink.findMany({
      where: {
        OR: [
          { fromItemId: itemId, userId: user.id },
          { toItemId: itemId, userId: user.id },
        ],
      },
      select: { fromItemId: true, toItemId: true },
    });
    const linkedIds = new Set<string>();
    for (const link of existingLinks) {
      linkedIds.add(link.fromItemId);
      linkedIds.add(link.toItemId);
    }
    linkedIds.delete(itemId);

    const matches = await findSimilarItems(user.id, "item", itemId, prisma, {
      excludeIds: [...linkedIds],
    });

    const { suggestions: suggestionMatches } = classifyMatches(matches);

    // Enrich with item details
    const entityIds = suggestionMatches.map((m) => m.entityId);
    const items = entityIds.length > 0
      ? await prisma.item.findMany({
          where: { id: { in: entityIds }, userId: user.id },
          select: { id: true, title: true, type: true, completedAt: true },
        })
      : [];
    const itemMap = new Map(items.map((i: { id: string; title: string; type: string; completedAt: Date | null }) => [i.id, i]));

    const enriched = suggestionMatches
      .filter((m) => itemMap.has(m.entityId))
      .map((m) => {
        const i = itemMap.get(m.entityId)!;
        return {
          entityId: m.entityId,
          title: i.title,
          type: i.type,
          status: i.completedAt ? "completed" : "active",
          similarity: m.similarity,
        };
      });

    return c.json({ suggestions: enriched });
  } catch (err) {
    console.error("[suggestions] Failed to get suggestions:", err);
    return c.json({ suggestions: [] });
  }
});

// GET /things/:id/list-suggestions — List assignment suggestions
suggestions.get("/things/:id/list-suggestions", async (c) => {
  const user = c.get("user");
  const itemId = c.req.param("id");

  const item = await prisma.item.findFirst({ where: { id: itemId, userId: user.id } });
  if (!item) return c.json({ error: "Not found" }, 404);

  try {
    const listSuggestions = await suggestLists(user.id, itemId, prisma);
    return c.json({ suggestions: listSuggestions });
  } catch (err) {
    console.error("[suggestions] Failed to get list suggestions:", err);
    return c.json({ suggestions: [] });
  }
});

// GET /events/:id/related-items — Related items for calendar events
suggestions.get("/events/:id/related-items", async (c) => {
  const user = c.get("user");
  const eventId = c.req.param("id");

  const event = await prisma.calendarEvent.findFirst({ where: { id: eventId, userId: user.id } });
  if (!event) return c.json({ error: "Not found" }, 404);

  try {
    const matches = await findSimilarItems(user.id, "calendar_event", eventId, prisma, {
      targetEntityType: "item",
    });

    const filtered = matches.filter((m) => m.similarity >= AI_CONFIG.embedding.crossTypeThreshold);

    // Enrich with item details
    const entityIds = filtered.map((m) => m.entityId);
    const items = entityIds.length > 0
      ? await prisma.item.findMany({
          where: { id: { in: entityIds }, userId: user.id },
          select: { id: true, title: true, type: true, completedAt: true },
        })
      : [];
    const itemMap = new Map(items.map((i: { id: string; title: string; type: string; completedAt: Date | null }) => [i.id, i]));

    const relatedItems = filtered
      .filter((m) => itemMap.has(m.entityId))
      .map((m) => {
        const i = itemMap.get(m.entityId)!;
        return {
          entityId: m.entityId,
          title: i.title,
          type: i.type,
          status: i.completedAt ? "completed" : "active",
          similarity: m.similarity,
        };
      });

    return c.json({ relatedItems });
  } catch (err) {
    console.error("[suggestions] Failed to get related items:", err);
    return c.json({ relatedItems: [] });
  }
});

// GET /events/:id/meeting-history — Recurring meeting context
suggestions.get("/events/:id/meeting-history", async (c) => {
  const user = c.get("user");
  const eventId = c.req.param("id");

  const event = await prisma.calendarEvent.findFirst({ where: { id: eventId, userId: user.id } });
  if (!event) return c.json({ error: "Not found" }, 404);

  if (!event.recurringEventId) {
    return c.json({ recurringEventId: null, pastOccurrences: [], relatedItems: [] });
  }

  try {
    // Find past events with same recurringEventId
    const pastEvents = await prisma.calendarEvent.findMany({
      where: {
        userId: user.id,
        recurringEventId: event.recurringEventId,
        startTime: { lt: event.startTime },
        id: { not: eventId },
      },
      orderBy: { startTime: "desc" },
      take: 10,
      select: {
        id: true,
        title: true,
        startTime: true,
        endTime: true,
        meetingNotes: {
          select: {
            id: true,
            title: true,
            summary: true,
          },
        },
      },
    });

    // Collect meeting note IDs and load linked items from tasks created from those notes
    const pastOccurrences = await Promise.all(
      pastEvents.map(async (pe) => {
        // Find items created from meeting notes of this event
        const linkedItems = await prisma.item.findMany({
          where: {
            userId: user.id,
            meetingNoteId: { in: pe.meetingNotes.map((n: { id: string }) => n.id) },
          },
          select: { id: true, title: true, type: true, completedAt: true },
        });

        return {
          eventId: pe.id,
          title: pe.title,
          startTime: pe.startTime.toISOString(),
          endTime: pe.endTime.toISOString(),
          meetingNotes: pe.meetingNotes.map((n: { id: string; title: string; summary: string | null }) => ({
            id: n.id,
            title: n.title,
            summary: n.summary,
          })),
          linkedItems: linkedItems.map((i) => ({
            id: i.id,
            title: i.title,
            type: i.type,
            status: i.completedAt ? "completed" : "active",
          })),
        };
      })
    );

    // Also find semantically related items via embeddings
    let relatedItems: Array<{ entityId: string; title: string; type: string; status: string; similarity: number }> = [];
    try {
      const matches = await findSimilarItems(user.id, "calendar_event", eventId, prisma, {
        targetEntityType: "item",
      });

      const filtered = matches.filter((m) => m.similarity >= AI_CONFIG.embedding.crossTypeThreshold);
      const entityIds = filtered.map((m) => m.entityId);
      const items = entityIds.length > 0
        ? await prisma.item.findMany({
            where: { id: { in: entityIds }, userId: user.id },
            select: { id: true, title: true, type: true, completedAt: true },
          })
        : [];
      const itemMap = new Map(items.map((i: { id: string; title: string; type: string; completedAt: Date | null }) => [i.id, i]));

      relatedItems = filtered
        .filter((m) => itemMap.has(m.entityId))
        .map((m) => {
          const i = itemMap.get(m.entityId)!;
          return {
            entityId: m.entityId,
            title: i.title,
            type: i.type,
            status: i.completedAt ? "completed" : "active",
            similarity: m.similarity,
          };
        });
    } catch {
      // Embeddings may not exist yet — that's fine
    }

    return c.json({
      recurringEventId: event.recurringEventId,
      pastOccurrences,
      relatedItems,
    });
  } catch (err) {
    console.error("[suggestions] Failed to get meeting history:", err);
    return c.json({ recurringEventId: event.recurringEventId, pastOccurrences: [], relatedItems: [] });
  }
});

export default suggestions;
