import type { EmbeddingProvider } from "../providers/types.js";
import {
  assembleItemText,
  assembleContentText,
  assembleEventText,
  assembleMeetingNoteText,
  assembleFindingText,
  assembleConversationText,
} from "./assembler.js";
import type {
  ItemAssemblerInput,
  ContentAssemblerInput,
  EventAssemblerInput,
  MeetingNoteAssemblerInput,
  FindingAssemblerInput,
  ConversationMessage,
} from "./assembler.js";
import { AI_CONFIG } from "../config.js";
import { classifyMatches } from "./similarity.js";

// --- Types ---

export interface EmbedEntityParams {
  entityType: string;
  entityId: string;
  userId: string;
  provider: EmbeddingProvider;
  // Prisma client — typed loosely since @brett/ai doesn't depend on Prisma
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prisma: any;
}

// --- Entity loaders + text assemblers ---

async function loadAndAssemble(
  entityType: string,
  entityId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prisma: any
): Promise<{ chunks: string[]; userId: string } | null> {
  switch (entityType) {
    case "item": {
      const item = await prisma.item.findUnique({
        where: { id: entityId },
        select: {
          title: true,
          description: true,
          notes: true,
          type: true,
          contentType: true,
          contentTitle: true,
          contentDescription: true,
          contentBody: true,
          userId: true,
        },
      });
      if (!item) return null;

      // Content items use the content assembler
      if (item.type === "content") {
        const input: ContentAssemblerInput = {
          type: item.contentType ?? "web_page",
          title: item.title,
          contentTitle: item.contentTitle,
          contentDescription: item.contentDescription,
          contentBody: item.contentBody,
        };
        return { chunks: assembleContentText(input), userId: item.userId };
      }

      // Task items use the item assembler
      const input: ItemAssemblerInput = {
        title: item.title,
        description: item.description,
        notes: item.notes,
      };
      return { chunks: assembleItemText(input), userId: item.userId };
    }

    case "calendar_event": {
      const event = await prisma.calendarEvent.findUnique({
        where: { id: entityId },
        select: {
          title: true,
          description: true,
          location: true,
          userId: true,
        },
      });
      if (!event) return null;

      const input: EventAssemblerInput = {
        title: event.title,
        description: event.description,
        location: event.location,
      };
      return { chunks: assembleEventText(input), userId: event.userId };
    }

    case "meeting_note": {
      const note = await prisma.meetingNote.findUnique({
        where: { id: entityId },
        select: {
          title: true,
          summary: true,
          transcript: true,
          userId: true,
        },
      });
      if (!note) return null;

      const input: MeetingNoteAssemblerInput = {
        title: note.title,
        summary: note.summary,
        transcript: note.transcript as MeetingNoteAssemblerInput["transcript"],
      };
      return {
        chunks: assembleMeetingNoteText(input),
        userId: note.userId,
      };
    }

    case "scout_finding": {
      const finding = await prisma.scoutFinding.findUnique({
        where: { id: entityId },
        select: {
          title: true,
          description: true,
          reasoning: true,
          scout: { select: { userId: true } },
        },
      });
      if (!finding) return null;

      const input: FindingAssemblerInput = {
        title: finding.title,
        description: finding.description,
        reasoning: finding.reasoning,
      };
      return {
        chunks: assembleFindingText(input),
        userId: finding.scout.userId,
      };
    }

    case "conversation": {
      const session = await prisma.conversationSession.findUnique({
        where: { id: entityId },
        select: {
          userId: true,
          messages: {
            select: { role: true, content: true },
            orderBy: { createdAt: "asc" as const },
          },
        },
      });
      if (!session) return null;

      const messages: ConversationMessage[] = session.messages;
      return {
        chunks: assembleConversationText(messages),
        userId: session.userId,
      };
    }

    default:
      console.warn(`[embedding] Unknown entity type: ${entityType}`);
      return null;
  }
}

// --- Core pipeline ---

/**
 * Loads an entity, assembles text chunks, generates embeddings, and upserts into the Embedding table.
 * Uses raw SQL for vector operations since Prisma doesn't support the vector type natively.
 */
export async function embedEntity(params: EmbedEntityParams): Promise<void> {
  const { entityType, entityId, provider, prisma } = params;

  // 1. Load entity and assemble text chunks
  const result = await loadAndAssemble(entityType, entityId, prisma);
  if (!result) {
    console.warn(
      `[embedding] Entity not found: ${entityType}:${entityId}, cleaning up stale embeddings`
    );
    await deleteEmbeddings(entityType, entityId, prisma);
    return;
  }

  const { chunks, userId } = result;

  if (chunks.length === 0) {
    await deleteEmbeddings(entityType, entityId, prisma);
    return;
  }

  // 2. Generate embeddings via provider (batch for efficiency)
  const { batchSize } = AI_CONFIG.embedding;
  const allVectors: number[][] = [];

  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize);
    const vectors = await provider.embedBatch(batch, "document");
    allVectors.push(...vectors);
  }

  // 3. Upsert each chunk into the Embedding table
  for (let i = 0; i < chunks.length; i++) {
    const vectorStr = `[${allVectors[i].join(",")}]`;
    await prisma.$executeRawUnsafe(
      `INSERT INTO "Embedding" (id, "userId", "entityType", "entityId", "chunkIndex", "chunkText", embedding, "createdAt", "updatedAt")
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6::vector, NOW(), NOW())
       ON CONFLICT ("entityType", "entityId", "chunkIndex")
       DO UPDATE SET "chunkText" = $5, embedding = $6::vector, "updatedAt" = NOW()`,
      userId,
      entityType,
      entityId,
      i,
      chunks[i],
      vectorStr
    );
  }

  // 4. Clean up orphaned chunks (if entity was re-chunked with fewer chunks)
  await prisma.$executeRawUnsafe(
    `DELETE FROM "Embedding" WHERE "entityType" = $1 AND "entityId" = $2 AND "chunkIndex" >= $3`,
    entityType,
    entityId,
    chunks.length
  );

  // 5. Auto-link detection for items
  if (entityType === "item") {
    try {
      const matches = await prisma.$queryRaw<Array<{ entityId: string; similarity: number }>>`
        SELECT e2."entityId", 1 - (e1.embedding <=> e2.embedding) as similarity
        FROM "Embedding" e1
        JOIN "Embedding" e2 ON e2."userId" = ${userId} AND e2."entityType" = 'item' AND e2."entityId" != ${entityId} AND e2."chunkIndex" = 0
        WHERE e1."entityType" = 'item' AND e1."entityId" = ${entityId} AND e1."chunkIndex" = 0
        ORDER BY e1.embedding <=> e2.embedding
        LIMIT 10
      `;

      const { autoLinks } = classifyMatches(matches);
      if (autoLinks.length > 0) {
        const matchIds = autoLinks.map((m) => m.entityId);

        // Batch: find all existing links involving these IDs
        const existingLinks = await prisma.itemLink.findMany({
          where: {
            OR: [
              { fromItemId: entityId, toItemId: { in: matchIds } },
              { fromItemId: { in: matchIds }, toItemId: entityId },
            ],
          },
          select: { fromItemId: true, toItemId: true },
        });
        const linkedIds = new Set<string>();
        for (const link of existingLinks) {
          linkedIds.add(link.fromItemId === entityId ? link.toItemId : link.fromItemId);
        }

        // Batch: load all target item types
        const unlinkedIds = matchIds.filter((id) => !linkedIds.has(id));
        const targets = unlinkedIds.length > 0
          ? await prisma.item.findMany({
              where: { id: { in: unlinkedIds }, userId },
              select: { id: true, type: true },
            })
          : [];
        const targetMap = new Map(targets.map((t: { id: string; type: string }) => [t.id, t.type]));

        // Create missing links
        for (const id of unlinkedIds) {
          const itemType = targetMap.get(id);
          if (itemType) {
            await prisma.itemLink.create({
              data: {
                fromItemId: entityId,
                toItemId: id,
                toItemType: itemType,
                source: "embedding",
                userId,
              },
            });
          }
        }
      }
    } catch (err) {
      console.error("[embedding] Auto-link failed:", err);
    }
  }
}

/**
 * Deletes all embeddings for a given entity. Call this when the source entity is deleted.
 */
export async function deleteEmbeddings(
  entityType: string,
  entityId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prisma: any
): Promise<void> {
  await prisma.$executeRawUnsafe(
    `DELETE FROM "Embedding" WHERE "entityType" = $1 AND "entityId" = $2`,
    entityType,
    entityId
  );
}
