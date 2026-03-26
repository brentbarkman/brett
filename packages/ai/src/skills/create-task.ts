import type { Skill } from "./types.js";
import { scopedLists } from "./scoped-queries.js";
import { validateCreateItem } from "@brett/business";

export const createTaskSkill: Skill = {
  name: "create_task",
  description: "Create a task.",
  parameters: {
    type: "object",
    properties: {
      title: { type: "string", description: "The task title" },
      dueDate: { type: "string", description: "ISO 8601 date (YYYY-MM-DD)" },
      dueDatePrecision: { type: "string", enum: ["day", "week"], description: "Use 'week' for 'this week'/'next week'" },
      listName: { type: "string", description: "List name to add to" },
      description: { type: "string" },
    },
    required: ["title"],
  },
  modelTier: "small",
  requiresAI: false,

  async execute(params, ctx) {
    const p = params as {
      title: string;
      dueDate?: string;
      dueDatePrecision?: string;
      listName?: string;
      description?: string;
    };

    let listId: string | undefined;
    if (p.listName && p.listName.toLowerCase() !== "inbox") {
      // Case-insensitive list lookup — user might say "podcasts" or "Podcasts"
      // "Inbox" is not a real list — it means no list assigned (listId = undefined)
      const lists = scopedLists(ctx.prisma, ctx.userId);
      const allLists = await lists.findMany({ where: { archivedAt: null } });
      const list = allLists.find(
        (l) => l.name.toLowerCase() === p.listName!.toLowerCase()
      );
      if (!list) {
        return { success: false, message: `List "${p.listName}" not found. Available lists: ${allLists.map(l => l.name).join(", ")}.` };
      }
      listId = list.id;
    }

    const validation = validateCreateItem({
      type: "task",
      title: p.title,
      dueDate: p.dueDate,
      dueDatePrecision: p.dueDatePrecision,
      description: p.description,
      listId,
      source: "Brett",
    });

    if (!validation.ok) {
      return { success: false, message: validation.error };
    }

    const item = await ctx.prisma.item.create({
      data: {
        type: "task",
        title: validation.data.title,
        description: validation.data.description,
        source: "Brett",
        dueDate: validation.data.dueDate ? new Date(validation.data.dueDate) : null,
        dueDatePrecision: validation.data.dueDatePrecision ?? null,
        status: "active",
        listId: listId ?? null,
        userId: ctx.userId,
      },
      include: { list: { select: { name: true } } },
    });

    return {
      success: true,
      data: { id: item.id, title: item.title, listName: item.list?.name },
      displayHint: { type: "confirmation" },
      message: `Created [${item.title}](brett-item:${item.id})${item.list ? ` in [${item.list.name}](brett-nav:/lists/${item.list.name.toLowerCase().replace(/\s+/g, "-")})` : ""}.`,
    };
  },
};
