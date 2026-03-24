import type { Skill } from "./types.js";
import { scopedItems } from "./scoped-queries.js";

export const getItemDetailSkill: Skill = {
  name: "get_item_detail",
  description:
    "Get full details for a specific item including notes, attachments, and links. Use when the user asks about details of a specific task or content item.",
  parameters: {
    type: "object",
    properties: {
      id: { type: "string", description: "The item ID to get details for" },
    },
    required: ["id"],
  },
  modelTier: "small",
  requiresAI: false,

  async execute(params, ctx) {
    const p = params as { id: string };
    const items = scopedItems(ctx.prisma, ctx.userId);
    const item = await items.findFirst({ id: p.id });

    if (!item) {
      return { success: false, message: "Item not found." };
    }

    return {
      success: true,
      data: {
        id: item.id,
        title: item.title,
        type: item.type,
        status: item.status,
        notes: item.notes,
        description: item.description,
        dueDate: item.dueDate?.toISOString() ?? null,
        source: item.source,
        sourceUrl: item.sourceUrl,
        brettObservation: item.brettObservation,
        createdAt: item.createdAt.toISOString(),
        updatedAt: item.updatedAt.toISOString(),
      },
      displayHint: { type: "detail" },
      message: `Details for "${item.title}".`,
    };
  },
};
