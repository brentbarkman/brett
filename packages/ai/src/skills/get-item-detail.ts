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

    const detail: Record<string, unknown> = {
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
    };

    // Include content-specific fields for content items (podcast, article, etc.)
    const anyItem = item as any;
    if (anyItem.contentType) detail.contentType = anyItem.contentType;
    if (anyItem.contentTitle) detail.contentTitle = anyItem.contentTitle;
    if (anyItem.contentDescription) detail.contentDescription = anyItem.contentDescription;
    if (anyItem.contentBody) detail.contentBody = typeof anyItem.contentBody === "string" && anyItem.contentBody.length > 2000
      ? anyItem.contentBody.slice(0, 2000) + "...[truncated]"
      : anyItem.contentBody;
    if (anyItem.contentFavicon) detail.contentFavicon = anyItem.contentFavicon;

    return {
      success: true,
      data: detail,
      displayHint: { type: "detail" },
      message: `Details for "${item.title}".`,
    };
  },
};
