import type { Skill } from "./types.js";
import { scopedItems } from "./scoped-queries.js";

export const completeTaskSkill: Skill = {
  name: "complete_task",
  description:
    "Mark one or more tasks as done. Pass a single id, an array of ids, or use 'all' to complete all active tasks (optionally filtered by scope: 'inbox', 'today', or 'all').",
  parameters: {
    type: "object",
    properties: {
      id: { type: "string", description: "Single task ID" },
      ids: {
        type: "array",
        items: { type: "string" },
        description: "Array of task IDs to complete in bulk",
      },
      all_inbox: {
        type: "boolean",
        description: "Complete all active inbox items (no list, no due date)",
      },
      all: {
        type: "boolean",
        description: "Complete ALL active tasks across inbox, today, and lists",
      },
    },
  },
  modelTier: "small",
  requiresAI: false,

  async execute(params, ctx) {
    const p = params as { id?: string; ids?: string[]; all_inbox?: boolean; all?: boolean };
    const items = scopedItems(ctx.prisma, ctx.userId);

    // Bulk: complete ALL active tasks
    if (p.all) {
      const result = await ctx.prisma.item.updateMany({
        where: {
          userId: ctx.userId,
          status: { notIn: ["done", "archived"] },
        },
        data: { status: "done", completedAt: new Date() },
      });
      return {
        success: true,
        data: { completed: result.count },
        displayHint: { type: "confirmation" },
        message: `Completed ${result.count} task${result.count !== 1 ? "s" : ""}.`,
      };
    }

    // Bulk: complete all inbox items (no list, no due date)
    if (p.all_inbox) {
      const result = await ctx.prisma.item.updateMany({
        where: {
          userId: ctx.userId,
          listId: null,
          dueDate: null,
          status: { notIn: ["done", "archived"] },
        },
        data: { status: "done", completedAt: new Date() },
      });
      return {
        success: true,
        data: { completed: result.count },
        displayHint: { type: "confirmation" },
        message: `Completed ${result.count} inbox item${result.count !== 1 ? "s" : ""}.`,
      };
    }

    // Bulk: complete by array of IDs
    if (p.ids && p.ids.length > 0) {
      const result = await ctx.prisma.item.updateMany({
        where: {
          id: { in: p.ids },
          userId: ctx.userId,
          status: { notIn: ["done", "archived"] },
        },
        data: { status: "done", completedAt: new Date() },
      });
      return {
        success: true,
        data: { completed: result.count },
        displayHint: { type: "confirmation" },
        message: `Completed ${result.count} task${result.count !== 1 ? "s" : ""}.`,
      };
    }

    // Single: complete by ID
    if (!p.id) {
      return { success: false, message: "Provide an id, ids, or all_inbox." };
    }

    try {
      const updated = await items.updateOwned(p.id, {
        status: "done",
        completedAt: new Date(),
      });
      return {
        success: true,
        data: { id: updated.id, title: updated.title },
        displayHint: { type: "confirmation" },
        message: `Completed [${updated.title}](brett-item:${updated.id}).`,
      };
    } catch {
      return { success: false, message: "Task not found." };
    }
  },
};
