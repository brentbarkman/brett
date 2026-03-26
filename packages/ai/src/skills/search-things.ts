import type { Skill } from "./types.js";
import { scopedItems } from "./scoped-queries.js";

export const searchThingsSkill: Skill = {
  name: "search_things",
  description:
    "Search across all items (tasks and content) by title keyword. Use when the user explicitly searches ('find...', 'search for...', 'look up...'), asks if something exists ('do I have a task about...?'), or references an item by partial name without knowing its ID ('the quarterly report task', 'that article about AI'). This is the go-to skill when you need to find an item and don't have its ID.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Search query to match against item titles, notes, content type (podcast, article, etc.), and content titles" },
      type: {
        type: "string",
        enum: ["task", "content"],
        description: "Filter by item type",
      },
      status: {
        type: "string",
        enum: ["active", "snoozed", "done", "archived"],
        description: "Filter by status",
      },
      limit: {
        type: "number",
        description: "Max results to return (default 10)",
      },
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
      },
      displayHint: { type: "list" },
      message: results.length > 0
        ? `Found ${results.length} item${results.length === 1 ? "" : "s"}: ${results.slice(0, 5).map((i: any) => `[${i.title}](brett-item:${i.id})`).join(", ")}. Use get_item_detail with an item's ID to get full content.`
        : `No items found matching "${p.query}".`,
    };
  },
};
