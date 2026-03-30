import type { Skill } from "./types.js";
import { scopedItems } from "./scoped-queries.js";
import { findMeetingsByQuery } from "./meeting-search.js";

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

    // Search across title, notes, and contentType (so "podcast" finds podcast content)
    const textFilter = { contains: p.query, mode: "insensitive" as const };
    const where: Record<string, unknown> = {
      OR: [
        { title: textFilter },
        { notes: textFilter },
        { contentType: textFilter },
        { contentTitle: textFilter },
      ],
    };
    if (p.type) where.type = p.type;
    if (p.status) where.status = p.status;

    const items = scopedItems(ctx.prisma, ctx.userId);
    const results = await items.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      take: Math.min(p.limit ?? 10, 25),
    });

    // Also search meetings for the same query
    const meetings = await findMeetingsByQuery(ctx.prisma, ctx.userId, p.query, 3);

    // Fetch linked Item records for each meeting (these are the actual tasks)
    const meetingIds = meetings.map((m) => m.id);
    const linkedItems = meetingIds.length > 0
      ? await ctx.prisma.item.findMany({
          where: { meetingNoteId: { in: meetingIds }, userId: ctx.userId, source: "Granola" },
          select: { id: true, title: true, status: true, dueDate: true, meetingNoteId: true },
          orderBy: { createdAt: "asc" },
        })
      : [];

    const meetingResults = meetings.map((m) => {
      const tasks = linkedItems.filter((i) => i.meetingNoteId === m.id);
      return {
        title: m.title,
        calendarEventId: m.calendarEventId,
        date: m.meetingStartedAt.toISOString().split("T")[0],
        summary: m.summary,
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
