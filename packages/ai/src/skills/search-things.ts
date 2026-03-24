import type { Skill } from "./types.js";
import { scopedItems } from "./scoped-queries.js";

export const searchThingsSkill: Skill = {
  name: "search_things",
  description:
    "Search across all items (tasks and content) by title. Use when the user asks to find, look up, or search for something. Returns matching items with their status and list.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Search query to match against item titles" },
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

    const where: Record<string, unknown> = {
      title: { contains: p.query, mode: "insensitive" },
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
      data: { items: results.map((i) => ({ id: i.id, title: i.title, type: i.type, status: i.status })) },
      displayHint: { type: "list" },
      message: results.length > 0
        ? `Found ${results.length} item${results.length === 1 ? "" : "s"} matching "${p.query}".`
        : `No items found matching "${p.query}".`,
    };
  },
};
