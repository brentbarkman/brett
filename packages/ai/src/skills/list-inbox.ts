import type { Skill } from "./types.js";
import { scopedItems } from "./scoped-queries.js";
import { itemToThing } from "@brett/business";

export const listInboxSkill: Skill = {
  name: "list_inbox",
  description: "List inbox items (no list, no due date).",
  parameters: {
    type: "object",
    properties: {
      limit: { type: "number" },
    },
  },
  modelTier: "small",
  requiresAI: false,

  async execute(params, ctx) {
    const p = params as { limit?: number };
    const now = new Date();

    const items = scopedItems(ctx.prisma, ctx.userId);
    const results = await items.findMany({
      where: {
        listId: null,
        dueDate: null,
        status: { notIn: ["done", "archived", "snoozed"] },
      },
      orderBy: { createdAt: "desc" },
      take: Math.min(p.limit ?? 20, 50),
    });

    const withLists = await ctx.prisma.item.findMany({
      where: {
        id: { in: results.map((r) => r.id) },
        userId: ctx.userId,
      },
      include: { list: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
    });

    const things = withLists.map((i) => itemToThing(i as any, now));

    return {
      success: true,
      data: { items: things },
      displayHint: { type: "list" },
      message: things.length > 0
        ? `${things.length} item${things.length === 1 ? "" : "s"} in your inbox.`
        : "Inbox is empty.",
    };
  },
};
