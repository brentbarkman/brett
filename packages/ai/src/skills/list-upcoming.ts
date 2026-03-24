import type { Skill } from "./types.js";
import { scopedItems } from "./scoped-queries.js";
import { getTodayUTC, itemToThing } from "@brett/business";

export const listUpcomingSkill: Skill = {
  name: "list_upcoming",
  description:
    "Show items with future due dates. Use when the user asks 'what's coming up?', 'what's next?', 'upcoming tasks', or wants to see future deadlines.",
  parameters: {
    type: "object",
    properties: {
      limit: {
        type: "number",
        description: "Max items to return (default 15)",
      },
    },
  },
  modelTier: "small",
  requiresAI: false,

  async execute(params, ctx) {
    const p = params as { limit?: number };
    const now = new Date();
    const todayEnd = new Date(getTodayUTC(now).getTime() + 86400000 - 1);

    const items = scopedItems(ctx.prisma, ctx.userId);
    const results = await items.findMany({
      where: {
        status: "active",
        dueDate: { gt: todayEnd },
      },
      orderBy: { dueDate: "asc" },
      take: Math.min(p.limit ?? 15, 50),
    });

    const withLists = await ctx.prisma.item.findMany({
      where: {
        id: { in: results.map((r) => r.id) },
        userId: ctx.userId,
      },
      include: { list: { select: { name: true } } },
      orderBy: { dueDate: "asc" },
    });

    const things = withLists.map((i) => itemToThing(i as any, now));

    return {
      success: true,
      data: { items: things },
      displayHint: { type: "list" },
      message: things.length > 0
        ? `${things.length} upcoming item${things.length === 1 ? "" : "s"}.`
        : "No upcoming items scheduled.",
    };
  },
};
