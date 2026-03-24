import type { Skill } from "./types.js";
import { scopedLists } from "./scoped-queries.js";

export const archiveListSkill: Skill = {
  name: "archive_list",
  description:
    "Archive a list and mark its incomplete items as done. Use when the user wants to archive, close, or finish a list/project.",
  parameters: {
    type: "object",
    properties: {
      listName: { type: "string", description: "Name of the list to archive" },
      listId: { type: "string", description: "List ID (alternative to listName)" },
    },
  },
  modelTier: "small",
  requiresAI: false,

  async execute(params, ctx) {
    const p = params as { listName?: string; listId?: string };
    const lists = scopedLists(ctx.prisma, ctx.userId);

    let list;
    if (p.listId) {
      list = await lists.findFirst({ id: p.listId, archivedAt: null });
    } else if (p.listName) {
      list = await lists.findFirst({ name: p.listName, archivedAt: null });
    } else {
      return { success: false, message: "Provide either listName or listId." };
    }

    if (!list) {
      return { success: false, message: `List "${p.listName || p.listId}" not found or already archived.` };
    }

    const now = new Date();
    const [, updateResult] = await ctx.prisma.$transaction([
      ctx.prisma.list.update({
        where: { id: list.id },
        data: { archivedAt: now },
      }),
      ctx.prisma.item.updateMany({
        where: { listId: list.id, status: { not: "done" } },
        data: { status: "done", completedAt: now },
      }),
    ]);

    return {
      success: true,
      data: { listId: list.id, listName: list.name, itemsCompleted: updateResult.count },
      displayHint: { type: "confirmation" },
      message: `Archived "${list.name}" and completed ${updateResult.count} remaining item${updateResult.count === 1 ? "" : "s"}.`,
    };
  },
};
