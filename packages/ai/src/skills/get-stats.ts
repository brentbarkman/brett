import type { Skill } from "./types.js";

export const getStatsSkill: Skill = {
  name: "get_stats",
  description:
    "Get task and list statistics. Use when the user asks 'how many tasks do I have?', 'show me my stats', 'how productive have I been?', or wants an overview of their items.",
  parameters: {
    type: "object",
    properties: {},
  },
  modelTier: "small",
  requiresAI: false,

  async execute(_params, ctx) {
    const [statusCounts, typeCounts, listCount, overdueCount] = await Promise.all([
      ctx.prisma.item.groupBy({
        by: ["status"],
        where: { userId: ctx.userId },
        _count: true,
      }),
      ctx.prisma.item.groupBy({
        by: ["type"],
        where: { userId: ctx.userId },
        _count: true,
      }),
      ctx.prisma.list.count({
        where: { userId: ctx.userId, archivedAt: null },
      }),
      ctx.prisma.item.count({
        where: {
          userId: ctx.userId,
          status: "active",
          dueDate: { lt: new Date() },
        },
      }),
    ]);

    const byStatus: Record<string, number> = {};
    for (const row of statusCounts) {
      byStatus[row.status] = row._count;
    }

    const byType: Record<string, number> = {};
    for (const row of typeCounts) {
      byType[row.type] = row._count;
    }

    const total = Object.values(byStatus).reduce((a, b) => a + b, 0);
    const active = byStatus["active"] ?? 0;
    const done = byStatus["done"] ?? 0;

    return {
      success: true,
      data: { byStatus, byType, listCount, overdueCount, total },
      displayHint: { type: "text" },
      message: `You have ${total} total items: ${active} active, ${done} completed, ${overdueCount} overdue. ${listCount} list${listCount === 1 ? "" : "s"}.`,
    };
  },
};
