import type { Skill } from "./types.js";
import { scopedItems, scopedLists } from "./scoped-queries.js";

export const moveToListSkill: Skill = {
  name: "move_to_list",
  description:
    "Move an item to a different list. Use when the user wants to organize an item into a specific list, or move it out of a list (to inbox). Resolves list by name or ID.",
  parameters: {
    type: "object",
    properties: {
      id: { type: "string", description: "The item ID to move" },
      listName: {
        type: "string",
        description: "Name of the target list. Use 'Inbox' or omit to remove from any list.",
      },
      listId: {
        type: "string",
        description: "Target list ID (alternative to listName)",
      },
    },
    required: ["id"],
  },
  modelTier: "small",
  requiresAI: false,

  async execute(params, ctx) {
    const p = params as { id: string; listName?: string; listId?: string };
    const items = scopedItems(ctx.prisma, ctx.userId);

    let targetListId: string | null = null;
    let targetListName = "Inbox";

    if (p.listId) {
      const lists = scopedLists(ctx.prisma, ctx.userId);
      const list = await lists.findFirst({ id: p.listId, archivedAt: null });
      if (!list) return { success: false, message: "Target list not found." };
      targetListId = list.id;
      targetListName = list.name;
    } else if (p.listName && p.listName.toLowerCase() !== "inbox") {
      const lists = scopedLists(ctx.prisma, ctx.userId);
      const allLists = await lists.findMany({ where: { archivedAt: null } });
      const list = allLists.find(
        (l) => l.name.toLowerCase() === p.listName!.toLowerCase()
      );
      if (!list) return { success: false, message: `List "${p.listName}" not found. Available lists: ${allLists.map(l => l.name).join(", ")}.` };
      targetListId = list.id;
      targetListName = list.name;
    }

    try {
      const updated = await items.updateOwned(p.id, { listId: targetListId });
      return {
        success: true,
        data: { id: updated.id, title: updated.title, listName: targetListName },
        displayHint: { type: "confirmation" },
        message: `Moved [${updated.title}](brett-item:${updated.id}) to ${targetListName ? `[${targetListName}](brett-nav:/lists/${targetListName.toLowerCase().replace(/\s+/g, "-")})` : "Inbox"}.`,
      };
    } catch {
      return { success: false, message: "Item not found." };
    }
  },
};
