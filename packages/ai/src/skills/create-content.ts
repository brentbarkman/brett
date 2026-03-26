import type { Skill } from "./types.js";
import { scopedLists } from "./scoped-queries.js";
import { validateCreateItem } from "@brett/business";

export const createContentSkill: Skill = {
  name: "create_content",
  description:
    "Save a content item (article, video, tweet, etc.) for the user. Use when they share a URL or want to save something to read/watch later. Extract the URL, title, and content type if identifiable.",
  parameters: {
    type: "object",
    properties: {
      title: { type: "string", description: "Content title or description" },
      sourceUrl: { type: "string", description: "URL of the content" },
      contentType: {
        type: "string",
        enum: ["tweet", "article", "video", "pdf", "podcast", "web_page"],
        description: "Type of content being saved",
      },
      listName: {
        type: "string",
        description: "Name of the list to add the content to",
      },
    },
    required: ["title"],
  },
  modelTier: "small",
  requiresAI: false,

  async execute(params, ctx) {
    const p = params as {
      title: string;
      sourceUrl?: string;
      contentType?: string;
      listName?: string;
    };

    let listId: string | undefined;
    if (p.listName) {
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

    let source = "Brett";
    if (p.sourceUrl) {
      try { source = new URL(p.sourceUrl).hostname; } catch { /* keep default */ }
    }

    const validation = validateCreateItem({
      type: "content",
      title: p.title,
      sourceUrl: p.sourceUrl,
      contentType: p.contentType,
      listId,
      source,
    });

    if (!validation.ok) {
      return { success: false, message: validation.error };
    }

    const item = await ctx.prisma.item.create({
      data: {
        type: "content",
        title: validation.data.title,
        source: validation.data.source ?? "Brett",
        sourceUrl: validation.data.sourceUrl ?? null,
        contentType: validation.data.contentType ?? null,
        contentStatus: "pending",
        status: "active",
        listId: listId ?? null,
        userId: ctx.userId,
      },
      include: { list: { select: { name: true } } },
    });

    return {
      success: true,
      data: { id: item.id, title: item.title },
      displayHint: { type: "confirmation" },
      message: `Saved "${item.title}"${item.list ? ` to [${item.list.name}](brett-nav:/lists/${item.list.name.toLowerCase().replace(/\s+/g, "-")})` : ""}.`,
    };
  },
};
