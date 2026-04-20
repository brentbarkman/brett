import type { Skill } from "./types.js";
import { hybridSearch } from "../embedding/search.js";

export const searchThingsSkill: Skill = {
  name: "search_things",
  description: "Search items by keyword. Use to find items when you don't have an ID.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Search query (matches titles, notes, content type)" },
      type: { type: "string", enum: ["task", "content"] },
      status: { type: "string", enum: ["active", "snoozed", "done", "archived"] },
      limit: { type: "number" },
    },
    required: ["query"],
  },
  modelTier: "small",
  requiresAI: false,

  async execute(params, ctx) {
    const p = params as {
      query: string;
      type?: string;
      status?: string;
      limit?: number;
    };

    const limit = Math.min(p.limit ?? 10, 25);

    // Determine which entity types to search.
    // Both "task" and "content" map to the "item" entity type in the embeddings table.
    // When no type filter is specified, also search meeting_notes.
    const entityTypes: string[] = p.type ? ["item"] : ["item", "meeting_note"];

    const searchResults = await hybridSearch(
      ctx.userId,
      p.query,
      entityTypes,
      ctx.embeddingProvider ?? null,
      ctx.prisma,
      limit * 2, // over-fetch to allow post-filtering
      ctx.rerankProvider ?? null,
    );

    // Separate item and meeting_note results
    const itemIds = searchResults
      .filter((r) => r.entityType === "item")
      .map((r) => r.entityId);
    const meetingIds = searchResults
      .filter((r) => r.entityType === "meeting_note")
      .map((r) => r.entityId);

    // Carry the matched chunk snippet per meeting so we can surface the
    // specific excerpt that matched — the summary alone often doesn't
    // cover transcript details the user is asking about.
    const meetingSnippetById = new Map<string, string>();
    for (const r of searchResults) {
      if (r.entityType === "meeting_note" && r.snippet) {
        meetingSnippetById.set(r.entityId, r.snippet);
      }
    }

    // Fetch full item records for enrichment and post-filtering
    const itemWhere: Record<string, unknown> = {
      id: { in: itemIds },
      userId: ctx.userId,
    };
    if (p.type) itemWhere.type = p.type;
    if (p.status) itemWhere.status = p.status;

    const fetchedItems = itemIds.length > 0
      ? await ctx.prisma.item.findMany({
          where: itemWhere,
          take: limit,
        })
      : [];

    // Re-order fetched items to match hybridSearch ranking order
    const itemById = new Map(fetchedItems.map((i: any) => [i.id, i]));
    const results = itemIds
      .map((id) => itemById.get(id))
      .filter(Boolean)
      .slice(0, limit);

    // Fetch full meeting records for enrichment
    const meetings = meetingIds.length > 0
      ? await ctx.prisma.meetingNote.findMany({
          where: { id: { in: meetingIds }, userId: ctx.userId },
          orderBy: { meetingStartedAt: "desc" },
          take: 3,
        })
      : [];

    // Fetch linked Item records for each meeting (these are the actual tasks)
    const linkedItems = meetings.length > 0
      ? await ctx.prisma.item.findMany({
          where: { meetingNoteId: { in: meetings.map((m) => m.id) }, userId: ctx.userId, source: "Granola" },
          select: { id: true, title: true, status: true, dueDate: true, meetingNoteId: true },
          orderBy: { createdAt: "asc" },
        })
      : [];

    const meetingResults = meetings.map((m) => {
      const tasks = linkedItems.filter((i) => i.meetingNoteId === m.id);
      const matchedExcerpt = meetingSnippetById.get(m.id) ?? null;
      return {
        title: m.title,
        calendarEventId: m.calendarEventId,
        date: m.meetingStartedAt.toISOString().split("T")[0],
        summary: m.summary,
        matchedExcerpt,
        tasks,
      };
    });

    const itemLines = results.length > 0
      ? `Found ${results.length} item${results.length === 1 ? "" : "s"}: ${results.slice(0, 5).map((i: any) => `[${i.title}](brett-item:${i.id})`).join(", ")}.`
      : "";

    const meetingLines = meetingResults.length > 0
      ? meetingResults.map((m) => {
          const titleLink = m.calendarEventId
            ? `[${m.title}](brett-event:${m.calendarEventId})`
            : `**${m.title}**`;
          const parts = [`${titleLink} (${m.date}):`];
          if (m.summary) {
            parts.push(m.summary);
          }
          if (isDistinctExcerpt(m.matchedExcerpt, m.summary)) {
            parts.push("**Matched excerpt:**");
            parts.push(m.matchedExcerpt!);
          }
          if (m.tasks.length > 0) {
            parts.push("**Tasks:**");
            parts.push(m.tasks.map((t) =>
              `- [${t.title}](brett-item:${t.id})${t.dueDate ? ` (due ${t.dueDate.toISOString().split("T")[0]})` : ""}`
            ).join("\n"));
          }
          return parts.join("\n\n");
        }).join("\n\n---\n\n")
      : "";

    const message = [itemLines, meetingLines].filter(Boolean).join("\n\n---\n\n")
      || `No items or meetings found matching "${p.query}".`;

    return {
      success: true,
      data: {
        items: results.map((i: any) => ({
          id: i.id,
          title: i.title,
          type: i.type,
          status: i.status,
          contentType: i.contentType ?? null,
          dueDate: i.dueDate?.toISOString() ?? null,
        })),
        meetings: meetingResults.map((m) => ({
          title: m.title,
          date: m.date,
          hasSummary: !!m.summary,
          taskCount: m.tasks.length,
        })),
      },
      displayHint: { type: "list" },
      message,
    };
  },
};

/**
 * An excerpt is worth showing alongside the summary only when it's
 * substantively different. If the chunk is just a slice of the summary
 * (the keyword path returns the whole summary as snippet), showing it
 * again is noise.
 */
function isDistinctExcerpt(
  excerpt: string | null | undefined,
  summary: string | null | undefined,
): boolean {
  if (!excerpt) return false;
  if (!summary) return true;
  const head = excerpt.slice(0, 80).trim();
  return head.length > 0 && !summary.includes(head);
}
