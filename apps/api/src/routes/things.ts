import { Hono } from "hono";
import { authMiddleware, type AuthEnv } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";
import { getPresignedUrl } from "../lib/storage.js";
import { itemToThing, validateCreateItem, validateBulkUpdate, validateUpdateItem, computeNextDueDate } from "@brett/business";
import { runExtraction } from "../lib/content-extractor.js";
import { detectContentType } from "@brett/utils";
import { enqueueEmbed, deleteEmbeddings, assembleItemText, assembleContentText, AI_CONFIG } from "@brett/ai";
import type { ItemAssemblerInput, ContentAssemblerInput } from "@brett/ai";
import type { ThingDetail, Attachment as AttachmentType, ItemLink as ItemLinkType, BrettMessage as BrettMessageType } from "@brett/types";
import { getEmbeddingProvider } from "../lib/embedding-provider.js";

const things = new Hono<AuthEnv>();

/** Enrich items with scout names for items where source === "scout" */
async function enrichWithScoutNames<T extends { source: string; sourceId: string | null }>(items: T[]): Promise<(T & { scoutName?: string })[]> {
  const scoutIds = [...new Set(items.filter((i) => i.source === "scout" && i.sourceId).map((i) => i.sourceId!))];
  if (scoutIds.length === 0) return items;
  const scouts = await prisma.scout.findMany({
    where: { id: { in: scoutIds } },
    select: { id: true, name: true },
  });
  const nameMap = new Map(scouts.map((s) => [s.id, s.name]));
  return items.map((item) => ({
    ...item,
    scoutName: item.source === "scout" && item.sourceId ? nameMap.get(item.sourceId) : undefined,
  }));
}

async function itemToThingDetail(item: any): Promise<ThingDetail> {
  // Enrich scout-originated items with scout name + finding feedback (parallelized)
  let scoutFindingId: string | undefined;
  let scoutFeedbackUseful: boolean | null | undefined;
  if (item.source === "scout") {
    const [scout, finding] = await Promise.all([
      item.sourceId && !item.scoutName
        ? prisma.scout.findUnique({ where: { id: item.sourceId }, select: { name: true } })
        : null,
      prisma.scoutFinding.findFirst({
        where: { itemId: item.id },
        select: { id: true, feedbackUseful: true },
      }),
    ]);
    if (scout) item.scoutName = scout.name;
    if (finding) {
      scoutFindingId = finding.id;
      scoutFeedbackUseful = finding.feedbackUseful;
    }
  }

  const thing = itemToThing(item);

  const attachments: AttachmentType[] = await Promise.all(
    (item.attachments || []).map(async (a: any) => ({
      id: a.id,
      filename: a.filename,
      mimeType: a.mimeType,
      sizeBytes: a.sizeBytes,
      url: await getPresignedUrl(a.storageKey, a.filename),
      createdAt: a.createdAt.toISOString(),
    }))
  );

  // Bidirectional links: query both directions
  const forwardLinks: any[] = item.linksFrom || [];

  // Reverse links: where this item is the target
  const reverseLinks = await prisma.itemLink.findMany({
    where: { toItemId: item.id, userId: item.userId },
    orderBy: { createdAt: "asc" },
  });

  // Collect all linked item IDs for title resolution
  const linkedItemIds = new Set<string>();
  forwardLinks.forEach((l: any) => linkedItemIds.add(l.toItemId));
  reverseLinks.forEach((l) => linkedItemIds.add(l.fromItemId));

  const linkedItems = linkedItemIds.size > 0
    ? await prisma.item.findMany({
        where: { id: { in: [...linkedItemIds] }, userId: item.userId },
        select: { id: true, title: true, type: true },
      })
    : [];
  const itemMap = new Map(linkedItems.map((t) => [t.id, t]));

  const links: ItemLinkType[] = [
    // Forward: A→B, shown on A as linking to B
    ...forwardLinks.map((l: any) => ({
      id: l.id,
      toItemId: l.toItemId,
      toItemType: l.toItemType,
      toItemTitle: itemMap.get(l.toItemId)?.title,
      source: l.source ?? "manual",
      createdAt: l.createdAt.toISOString(),
    })),
    // Reverse: B→A stored as fromItemId=B, shown on A as linking to B
    ...reverseLinks.map((l) => ({
      id: l.id,
      toItemId: l.fromItemId,
      toItemType: itemMap.get(l.fromItemId)?.type ?? "task",
      toItemTitle: itemMap.get(l.fromItemId)?.title,
      source: l.source ?? "manual",
      createdAt: l.createdAt.toISOString(),
    })),
  ];

  const brettMessages: BrettMessageType[] = (item.brettMessages || [])
    .slice(0, 20)
    .map((m: any) => ({
      id: m.id,
      role: m.role as "user" | "brett",
      content: m.content,
      createdAt: m.createdAt.toISOString(),
    }));

  return {
    ...thing,
    notes: item.notes ?? undefined,
    reminder: item.reminder ?? undefined,
    recurrence: item.recurrence ?? undefined,
    recurrenceRule: item.recurrenceRule ?? undefined,
    brettTakeGeneratedAt: item.brettTakeGeneratedAt?.toISOString(),
    // Content detail fields
    contentTitle: item.contentTitle ?? undefined,
    contentDescription: item.contentDescription ?? undefined,
    contentBody: item.contentBody ?? undefined,
    contentFavicon: item.contentFavicon ?? undefined,
    contentMetadata: item.contentMetadata ?? undefined,
    attachments,
    links,
    brettMessages,
    scoutFindingId,
    scoutFeedbackUseful,
  };
}

async function verifyListOwnership(listId: string, userId: string) {
  const list = await prisma.list.findFirst({
    where: { id: listId, userId },
  });
  return !!list;
}

// All routes require auth
things.use("*", authMiddleware);

// GET /things — list things with optional filters
// Supports date range filters:
//   dueBefore=ISO   — items with dueDate <= value (inclusive)
//   dueAfter=ISO    — items with dueDate > value (exclusive)
//   completedAfter=ISO — items with completedAt >= value
things.get("/", async (c) => {
  const user = c.get("user");
  const { listId, type, status, source, dueBefore, dueAfter, completedAfter, search } = c.req.query();

  const where: Record<string, unknown> = { userId: user.id };
  if (search) {
    where.OR = [
      { title: { contains: search, mode: "insensitive" } },
      { notes: { contains: search, mode: "insensitive" } },
    ];
  }
  if (listId) where.listId = listId;
  if (type) where.type = type;
  if (status) where.status = status;
  if (source) where.source = source;
  if (dueBefore && dueAfter) {
    where.dueDate = { gt: new Date(dueAfter), lte: new Date(dueBefore) };
  } else if (dueBefore) {
    where.dueDate = { lte: new Date(dueBefore) };
  } else if (dueAfter) {
    where.dueDate = { gt: new Date(dueAfter) };
  }
  if (completedAfter) where.completedAt = { gte: new Date(completedAfter) };

  const items = await prisma.item.findMany({
    where,
    include: { list: { select: { name: true } }, meetingNote: { select: { title: true, calendarEventId: true } } },
    orderBy: [{ createdAt: "desc" }],
  });

  const enriched = await enrichWithScoutNames(items);
  const thingsList = enriched.map((item) => itemToThing(item as any));
  return c.json(thingsList);
});

// PATCH /things/bulk — bulk update
things.patch("/bulk", async (c) => {
  const user = c.get("user");
  const body = await c.req.json();
  const validation = validateBulkUpdate(body);

  if (!validation.ok) {
    return c.json({ error: validation.error }, 400);
  }

  const { data } = validation;

  // Verify all IDs belong to the user
  const count = await prisma.item.count({
    where: { id: { in: data.ids }, userId: user.id },
  });
  if (count !== data.ids.length) {
    return c.json({ error: "One or more items not found" }, 400);
  }

  // If listId is a non-null string, verify list ownership
  if (typeof data.updates.listId === "string") {
    if (!(await verifyListOwnership(data.updates.listId, user.id))) {
      return c.json({ error: "List not found" }, 400);
    }
  }

  const updateData: Record<string, unknown> = {};
  if (data.updates.listId !== undefined) updateData.listId = data.updates.listId;
  if (data.updates.dueDate !== undefined)
    updateData.dueDate = data.updates.dueDate ? new Date(data.updates.dueDate) : null;
  if (data.updates.dueDatePrecision !== undefined)
    updateData.dueDatePrecision = data.updates.dueDatePrecision;
  if (data.updates.status !== undefined) updateData.status = data.updates.status;

  const result = await prisma.item.updateMany({
    where: { id: { in: data.ids }, userId: user.id },
    data: updateData,
  });

  return c.json({ updated: result.count });
});

// GET /things/inbox — items with no due date and no list
things.get("/inbox", async (c) => {
  const user = c.get("user");
  const now = new Date();

  const items = await prisma.item.findMany({
    where: {
      userId: user.id,
      listId: null,
      dueDate: null,
      status: { notIn: ["done", "archived", "snoozed"] },
      OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: now } }],
    },
    include: { list: { select: { name: true } }, meetingNote: { select: { title: true, calendarEventId: true } } },
    orderBy: [{ createdAt: "desc" }],
  });

  const enriched = await enrichWithScoutNames(items);
  return c.json({
    visible: enriched.map((item) => itemToThing(item as any)),
  });
});

// GET /things/:id — single thing (returns ThingDetail with relations)
things.get("/:id", async (c) => {
  const user = c.get("user");
  const item = await prisma.item.findFirst({
    where: { id: c.req.param("id"), userId: user.id },
    include: {
      list: { select: { name: true } },
      meetingNote: { select: { title: true, calendarEventId: true } },
      attachments: { orderBy: { createdAt: "asc" } },
      linksFrom: { orderBy: { createdAt: "asc" } },
      brettMessages: { orderBy: { createdAt: "desc" }, take: 20 },
    },
  });

  if (!item) return c.json({ error: "Not found" }, 404);
  return c.json(await itemToThingDetail(item));
});

// POST /things — create
things.post("/", async (c) => {
  const user = c.get("user");
  const body = await c.req.json();
  const validation = validateCreateItem(body);

  if (!validation.ok) {
    return c.json({ error: validation.error }, 400);
  }

  const { data } = validation;

  // If listId provided, verify the list belongs to the user
  if (data.listId && !(await verifyListOwnership(data.listId, user.id))) {
    return c.json({ error: "List not found" }, 400);
  }

  const item = await prisma.item.create({
    data: {
      type: data.type,
      title: data.title,
      description: data.description,
      source: data.source ?? (data.type === "content" && data.sourceUrl ? new URL(data.sourceUrl).hostname : "Brett"),
      sourceUrl: data.sourceUrl,
      contentType: data.contentType ?? (data.sourceUrl ? detectContentType(data.sourceUrl) : null),
      contentStatus: data.type === "content" ? "pending" : null,
      dueDate: data.dueDate ? new Date(data.dueDate) : null,
      dueDatePrecision: data.dueDatePrecision ?? null,
      brettObservation: data.brettObservation,
      status: data.status ?? "active",
      listId: data.listId ?? null,
      userId: user.id,
    },
    include: { list: { select: { name: true } }, meetingNote: { select: { title: true, calendarEventId: true } } },
  });

  const thing = itemToThing(item as any);

  // Inline embedding + duplicate detection
  let duplicateCandidates: Array<{ id: string; title: string; similarity: number }> | undefined;
  try {
    const embeddingProvider = getEmbeddingProvider();
    if (embeddingProvider) {
      // Assemble text for the new item
      let chunks: string[];
      if (data.type === "content") {
        const input: ContentAssemblerInput = {
          type: item.contentType ?? "web_page",
          title: item.title,
          contentTitle: null,
          contentDescription: null,
          contentBody: null,
        };
        chunks = assembleContentText(input);
      } else {
        const input: ItemAssemblerInput = {
          title: item.title,
          description: item.description ?? null,
          notes: null,
        };
        chunks = assembleItemText(input);
      }

      if (chunks.length > 0) {
        // Embed just the first chunk (fastest, good enough for dedup)
        const [vector] = await embeddingProvider.embedBatch([chunks[0]], "document");
        const vectorStr = `[${vector.join(",")}]`;

        // Store in the Embedding table (parameterized via tagged template to prevent injection)
        await prisma.$executeRaw`
          INSERT INTO "Embedding" (id, "userId", "entityType", "entityId", "chunkIndex", "chunkText", embedding, "createdAt", "updatedAt")
          VALUES (gen_random_uuid(), ${user.id}, ${"item"}, ${item.id}, ${0}, ${chunks[0]}, ${vectorStr}::vector, NOW(), NOW())
          ON CONFLICT ("entityType", "entityId", "chunkIndex")
          DO UPDATE SET "chunkText" = EXCLUDED."chunkText", embedding = EXCLUDED.embedding, "updatedAt" = NOW()`;

        // Query for near-duplicates above the threshold
        const threshold = AI_CONFIG.embedding.dupThreshold;
        const dupes = await prisma.$queryRaw<Array<{ entityId: string; similarity: number }>>`
          SELECT e2."entityId", 1 - (e1.embedding <=> e2.embedding) AS similarity
          FROM "Embedding" e1
          JOIN "Embedding" e2
            ON e2."userId" = ${user.id}
            AND e2."entityType" = 'item'
            AND e2."entityId" != ${item.id}
            AND e2."chunkIndex" = 0
          WHERE e1."entityType" = 'item'
            AND e1."entityId" = ${item.id}
            AND e1."chunkIndex" = 0
            AND 1 - (e1.embedding <=> e2.embedding) >= ${threshold}
          ORDER BY similarity DESC
          LIMIT 5
        `;

        if (dupes.length > 0) {
          // Enrich with titles
          const dupeItems = await prisma.item.findMany({
            where: { id: { in: dupes.map((d) => d.entityId) }, userId: user.id },
            select: { id: true, title: true },
          });
          const titleMap = new Map(dupeItems.map((d) => [d.id, d.title]));
          duplicateCandidates = dupes
            .filter((d) => titleMap.has(d.entityId))
            .map((d) => ({
              id: d.entityId,
              title: titleMap.get(d.entityId)!,
              similarity: d.similarity,
            }));
        }

        // Queue full pipeline — handles remaining chunks for content items.
        // Skip auto-link since inline dup detection already ran above.
        enqueueEmbed({ entityType: "item", entityId: item.id, userId: user.id, skipAutoLink: true });
      }
    } else {
      // No embedding provider — fall back to async queue
      enqueueEmbed({ entityType: "item", entityId: item.id, userId: user.id });
    }
  } catch (err) {
    console.error(`[things] Inline embed/dedup failed for ${item.id}:`, err);
    // Dedup failure must NOT block item creation — fall through
  }

  // Fire-and-forget extraction for content items (re-embeds after content is fetched)
  if (data.type === "content" && data.sourceUrl) {
    runExtraction(item.id, data.sourceUrl, user.id).catch((err) =>
      console.error(`[things] Background extraction failed for ${item.id}:`, err)
    );
  }

  return c.json({ ...thing, duplicateCandidates }, 201);
});

/** Spawn the next occurrence of a recurring task */
async function spawnNextRecurrence(
  item: { id: string; type: string; title: string; notes: string | null; description: string | null; source: string; dueDate: Date | null; dueDatePrecision: string | null; recurrence: string | null; recurrenceRule: string | null; listId: string | null; userId: string },
  linksFrom: { toItemId: string; toItemType: string }[],
) {
  if (!item.recurrence) return;

  const newDueDate = computeNextDueDate(
    item.dueDate,
    item.recurrence,
    item.recurrenceRule,
  );

  const newItem = await prisma.item.create({
    data: {
      type: item.type,
      title: item.title,
      notes: item.notes,
      description: item.description,
      source: item.source,
      dueDate: newDueDate,
      dueDatePrecision: item.dueDatePrecision,
      recurrence: item.recurrence,
      recurrenceRule: item.recurrenceRule,
      listId: item.listId,
      userId: item.userId,
    },
  });

  if (linksFrom.length > 0) {
    await prisma.itemLink.createMany({
      data: linksFrom.map((l) => ({
        fromItemId: newItem.id,
        toItemId: l.toItemId,
        toItemType: l.toItemType,
        userId: item.userId,
      })),
    });
  }
}

// PATCH /things/:id — update
things.patch("/:id", async (c) => {
  const user = c.get("user");
  const body = await c.req.json();
  const validation = validateUpdateItem(body);

  if (!validation.ok) {
    return c.json({ error: validation.error }, 400);
  }

  const { data } = validation;
  const id = c.req.param("id");

  // Verify ownership
  const existing = await prisma.item.findFirst({
    where: { id, userId: user.id },
  });
  if (!existing) return c.json({ error: "Not found" }, 404);

  // If changing list, verify ownership
  if (data.listId && !(await verifyListOwnership(data.listId, user.id))) {
    return c.json({ error: "List not found" }, 400);
  }

  const updateData: Record<string, unknown> = {};
  if (data.title !== undefined) updateData.title = data.title;
  if (data.description !== undefined) updateData.description = data.description;
  if (data.source !== undefined) updateData.source = data.source;
  if (data.sourceUrl !== undefined) updateData.sourceUrl = data.sourceUrl;
  if (data.dueDate !== undefined)
    updateData.dueDate = data.dueDate ? new Date(data.dueDate) : null;
  if (data.dueDatePrecision !== undefined)
    updateData.dueDatePrecision = data.dueDatePrecision;
  if (data.brettObservation !== undefined)
    updateData.brettObservation = data.brettObservation;
  if (data.listId !== undefined) updateData.listId = data.listId;
  if (data.status !== undefined) updateData.status = data.status;
  if (data.snoozedUntil !== undefined)
    updateData.snoozedUntil = data.snoozedUntil
      ? new Date(data.snoozedUntil)
      : null;
  if (data.notes !== undefined)
    updateData.notes = data.notes;
  if (data.reminder !== undefined)
    updateData.reminder = data.reminder;
  if (data.recurrence !== undefined)
    updateData.recurrence = data.recurrence;
  if (data.recurrenceRule !== undefined)
    updateData.recurrenceRule = data.recurrenceRule;
  if (data.contentType !== undefined) updateData.contentType = data.contentType;
  if (data.contentStatus !== undefined) updateData.contentStatus = data.contentStatus;
  if (data.contentTitle !== undefined) updateData.contentTitle = data.contentTitle;
  if (data.contentDescription !== undefined) updateData.contentDescription = data.contentDescription;
  if (data.contentImageUrl !== undefined) updateData.contentImageUrl = data.contentImageUrl;
  if (data.contentBody !== undefined) updateData.contentBody = data.contentBody;
  if (data.contentFavicon !== undefined) updateData.contentFavicon = data.contentFavicon;
  if (data.contentDomain !== undefined) updateData.contentDomain = data.contentDomain;
  if (data.contentMetadata !== undefined) updateData.contentMetadata = data.contentMetadata;

  const item = await prisma.item.update({
    where: { id: existing.id },
    data: updateData,
    include: { list: { select: { name: true } }, meetingNote: { select: { title: true, calendarEventId: true } }, linksFrom: true },
  });

  // Re-embed if text fields changed
  if (data.title !== undefined || data.description !== undefined || data.notes !== undefined) {
    enqueueEmbed({ entityType: "item", entityId: id, userId: user.id });
  }

  // If recurrence was just set on an already-completed task, spawn next occurrence now
  const recurrenceJustSet = data.recurrence !== undefined && data.recurrence !== null;
  const wasAlreadyCompleted = existing.completedAt !== null;
  const hadNoRecurrence = !existing.recurrence;
  if (recurrenceJustSet && wasAlreadyCompleted && hadNoRecurrence) {
    await spawnNextRecurrence(item, item.linksFrom);
  }

  return c.json(itemToThing(item as any));
});

// PATCH /things/:id/toggle — toggle completion
things.patch("/:id/toggle", async (c) => {
  const user = c.get("user");
  const existing = await prisma.item.findFirst({
    where: { id: c.req.param("id"), userId: user.id },
    include: { list: { select: { name: true } }, meetingNote: { select: { title: true, calendarEventId: true } }, linksFrom: true },
  });
  if (!existing) return c.json({ error: "Not found" }, 404);

  const isCompleted = existing.completedAt !== null;
  const item = await prisma.item.update({
    where: { id: existing.id },
    data: {
      completedAt: isCompleted ? null : new Date(),
      status: isCompleted ? "active" : "done",
    },
    include: { list: { select: { name: true } }, meetingNote: { select: { title: true, calendarEventId: true } } },
  });

  // If completing a recurring task, spawn a new independent task
  if (!isCompleted && existing.recurrence) {
    await spawnNextRecurrence(existing, existing.linksFrom);
  }

  return c.json(itemToThing(item as any));
});

// DELETE /things/:id
things.delete("/:id", async (c) => {
  const user = c.get("user");
  const existing = await prisma.item.findFirst({
    where: { id: c.req.param("id"), userId: user.id },
  });
  if (!existing) return c.json({ error: "Not found" }, 404);

  await deleteEmbeddings("item", existing.id, prisma);
  await prisma.item.delete({ where: { id: existing.id } });
  return c.json({ ok: true });
});

export { things };
