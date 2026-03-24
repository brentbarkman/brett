import type { Skill } from "./types.js";
import { scopedLists } from "./scoped-queries.js";
import { validateCreateItem } from "@brett/business";

export const createTaskSkill: Skill = {
  name: "create_task",
  description:
    "Create a new task for the user. Use when they want to add something to their todo list, set a reminder, or track something they need to do. Extract the title, due date, and list if mentioned.",
  parameters: {
    type: "object",
    properties: {
      title: { type: "string", description: "The task title" },
      dueDate: {
        type: "string",
        description: "ISO 8601 date string for when the task is due",
      },
      dueDatePrecision: {
        type: "string",
        enum: ["day", "week"],
        description: "Whether the due date is day-precise or week-precise",
      },
      listName: {
        type: "string",
        description: "Name of the list to add the task to (resolved to ID)",
      },
      description: { type: "string", description: "Optional task description" },
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
    if (p.listName) {
      const lists = scopedLists(ctx.prisma, ctx.userId);
      const list = await lists.findFirst({ name: p.listName, archivedAt: null });
      if (!list) {
        return { success: false, message: `List "${p.listName}" not found.` };
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
      message: `Created task "${item.title}"${item.list ? ` in ${item.list.name}` : ""}.`,
    };
  },
};
