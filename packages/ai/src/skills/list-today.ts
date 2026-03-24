import type { Skill } from "./types.js";
import { scopedItems } from "./scoped-queries.js";
import { getTodayUTC, itemToThing } from "@brett/business";

export const listTodaySkill: Skill = {
  name: "list_today",
  description:
    "Show items due today or overdue. Use when the user asks 'what do I have today?', 'what's on my plate?', 'what's due?', or similar. Returns active tasks due today or past due.",
  parameters: {
    type: "object",
    properties: {},
  },
  modelTier: "small",
  requiresAI: false,

  async execute(_params, ctx) {
    const now = new Date();
    const todayStart = getTodayUTC(now);
    const todayEnd = new Date(todayStart.getTime() + 86400000 - 1);

    const items = scopedItems(ctx.prisma, ctx.userId);
    const results = await items.findMany({
      where: {
        status: "active",
        dueDate: { lte: todayEnd },
      },
      orderBy: { dueDate: "asc" },
    });

    // Include list relation for itemToThing
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
        ? `You have ${things.length} item${things.length === 1 ? "" : "s"} due today or overdue.`
        : "Nothing due today. You're all caught up!",
    };
  },
};
