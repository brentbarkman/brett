import type { Skill } from "./types.js";
import { scopedLists } from "./scoped-queries.js";
import { validateCreateItem } from "@brett/business";
import { detectContentType } from "@brett/utils";

export const createContentSkill: Skill = {
  name: "create_content",
  description: "Save content (article, video, tweet, etc.).",
  parameters: {
    type: "object",
    properties: {
      title: { type: "string" },
      sourceUrl: { type: "string", description: "URL" },
      contentType: { type: "string", enum: ["tweet", "article", "video", "pdf", "podcast", "web_page"] },
      listName: { type: "string" },
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
    if (p.listName && p.listName.toLowerCase() !== "inbox") {
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

    // If the title is just a URL, path slug, or ID-like string, replace with a
    // friendly placeholder. The real title gets filled in by content extraction.
    let title = p.title;
    const looksLikeUrl = /^https?:\/\//.test(title);
    const looksLikeSlug = /^[a-zA-Z0-9_-]{6,}$/.test(title) && !/\s/.test(title);
    if (looksLikeUrl || looksLikeSlug) {
      const typeLabel = p.contentType
        ? p.contentType.replace("_", " ")
        : "link";
      const domain = source !== "Brett" ? source.replace(/^www\./, "") : "";
      title = domain ? `Saved ${typeLabel} from ${domain}` : `Saved ${typeLabel}`;
    }

    // Detect content type from URL patterns — don't rely on the LLM to classify.
    // This ensures the correct icon shows immediately, before extraction runs.
    const contentType = p.sourceUrl
      ? detectContentType(p.sourceUrl)
      : p.contentType ?? undefined;

    const validation = validateCreateItem({
      type: "content",
      title,
      sourceUrl: p.sourceUrl,
      contentType,
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

    // Trigger background content extraction (same as direct POST /things path)
    if (p.sourceUrl && ctx.onContentCreated) {
      ctx.onContentCreated(item.id, p.sourceUrl);
    }

    return {
      success: true,
      data: { id: item.id, title: item.title },
      displayHint: { type: "confirmation" },
      message: `Saved [${item.title}](brett-item:${item.id})${item.list ? ` to [${item.list.name}](brett-nav:/lists/${item.list.name.toLowerCase().replace(/\s+/g, "-")})` : ""}.`,
    };
  },
};
