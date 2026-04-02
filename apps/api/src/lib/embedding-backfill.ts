import { prisma } from "./prisma.js";
import { getEmbeddingProvider } from "./embedding-provider.js";
import { embedEntity } from "@brett/ai";

export async function runEmbeddingBackfill(): Promise<{ processed: number; errors: number }> {
  const provider = getEmbeddingProvider();
  if (!provider) return { processed: 0, errors: 0 };

  let processed = 0;
  let errors = 0;

  // Items
  const items = await prisma.$queryRaw<Array<{ id: string; userId: string }>>`
    SELECT i.id, i."userId"
    FROM "Item" i
    LEFT JOIN "Embedding" e ON e."entityType" = 'item' AND e."entityId" = i.id
    WHERE e.id IS NULL
    LIMIT 500
  `;

  for (const item of items) {
    try {
      await embedEntity({ entityType: "item", entityId: item.id, userId: item.userId, provider, prisma });
      processed++;
    } catch (err) {
      errors++;
      console.error(`[backfill] Failed to embed item ${item.id}:`, err);
    }
    await new Promise((r) => setTimeout(r, 100));
  }

  // CalendarEvents
  const calendarEvents = await prisma.$queryRaw<Array<{ id: string; userId: string }>>`
    SELECT ce.id, ce."userId"
    FROM "CalendarEvent" ce
    LEFT JOIN "Embedding" e ON e."entityType" = 'calendar_event' AND e."entityId" = ce.id
    WHERE e.id IS NULL
    LIMIT 500
  `;

  for (const event of calendarEvents) {
    try {
      await embedEntity({ entityType: "calendar_event", entityId: event.id, userId: event.userId, provider, prisma });
      processed++;
    } catch (err) {
      errors++;
      console.error(`[backfill] Failed to embed calendar_event ${event.id}:`, err);
    }
    await new Promise((r) => setTimeout(r, 100));
  }

  // MeetingNotes
  const meetingNotes = await prisma.$queryRaw<Array<{ id: string; userId: string }>>`
    SELECT mn.id, mn."userId"
    FROM "MeetingNote" mn
    LEFT JOIN "Embedding" e ON e."entityType" = 'meeting_note' AND e."entityId" = mn.id
    WHERE e.id IS NULL
    LIMIT 500
  `;

  for (const note of meetingNotes) {
    try {
      await embedEntity({ entityType: "meeting_note", entityId: note.id, userId: note.userId, provider, prisma });
      processed++;
    } catch (err) {
      errors++;
      console.error(`[backfill] Failed to embed meeting_note ${note.id}:`, err);
    }
    await new Promise((r) => setTimeout(r, 100));
  }

  // ScoutFindings — userId lives on Scout, join through it
  const scoutFindings = await prisma.$queryRaw<Array<{ id: string; userId: string }>>`
    SELECT sf.id, s."userId"
    FROM "ScoutFinding" sf
    JOIN "Scout" s ON sf."scoutId" = s.id
    LEFT JOIN "Embedding" e ON e."entityType" = 'scout_finding' AND e."entityId" = sf.id
    WHERE e.id IS NULL
    LIMIT 500
  `;

  for (const finding of scoutFindings) {
    try {
      await embedEntity({ entityType: "scout_finding", entityId: finding.id, userId: finding.userId, provider, prisma });
      processed++;
    } catch (err) {
      errors++;
      console.error(`[backfill] Failed to embed scout_finding ${finding.id}:`, err);
    }
    await new Promise((r) => setTimeout(r, 100));
  }

  console.log(`[backfill] Complete: ${processed} processed, ${errors} errors`);
  return { processed, errors };
}
