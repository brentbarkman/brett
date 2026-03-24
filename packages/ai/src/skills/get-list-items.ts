import type { Skill } from "./types.js";
import { scopedItems, scopedLists } from "./scoped-queries.js";
import { itemToThing } from "@brett/business";

export const getListItemsSkill: Skill = {
  name: "get_list_items",
  description:
    "Show items in a specific CUSTOM LIST by name or ID. Use when the user references a list they created, e.g., 'show my Work list', 'what's in Reading?', 'show me the Groceries list'. Do NOT use for built-in views — use list_today for Today, list_inbox for Inbox, list_upcoming for Upcoming.",
  parameters: {
    type: "object",
    properties: {
      listName: { type: "string", description: "Name of the list to show" },
      listId: { type: "string", description: "List ID (alternative to listName)" },
      includeCompleted: {
        type: "boolean",
        description: "Whether to include completed items (default false)",
      },
    },
  },
  modelTier: "small",
  requiresAI: false,

  async execute(params, ctx) {
    const p = params as { listName?: string; listId?: string; includeCompleted?: boolean };

    const lists = scopedLists(ctx.prisma, ctx.userId);
    let list;

    if (p.listId) {
      list = await lists.findFirst({ id: p.listId });
    } else if (p.listName) {
      list = await lists.findFirst({ name: p.listName });
    } else {
      return { success: false, message: "Provide either listName or listId." };
    }

    if (!list) {
      return { success: false, message: `List "${p.listName || p.listId}" not found.` };
    }

    const where: Record<string, unknown> = { listId: list.id };
    if (!p.includeCompleted) {
      where.status = { notIn: ["done", "archived"] };
    }

    const items = scopedItems(ctx.prisma, ctx.userId);
    const results = await items.findMany({ where, orderBy: { createdAt: "desc" } });

    const withLists = await ctx.prisma.item.findMany({
      where: {
        id: { in: results.map((r) => r.id) },
        userId: ctx.userId,
      },
      include: { list: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
    });

    const things = withLists.map((i) => itemToThing(i as any));

    return {
      success: true,
      data: { listName: list.name, items: things },
      displayHint: { type: "list" },
      message: things.length > 0
        ? `${things.length} item${things.length === 1 ? "" : "s"} in "${list.name}".`
        : `"${list.name}" is empty.`,
    };
  },
};
