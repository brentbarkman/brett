import type { Skill } from "./types.js";

export const listScoutsSkill: Skill = {
  name: "list_scouts",
  description: "List the user's scouts, optionally filtered by status.",
  parameters: {
    type: "object",
    properties: {
      status: {
        type: "string",
        enum: ["active", "paused", "completed", "expired", "all"],
        description: "Filter by scout status. Default: active.",
      },
    },
    required: [],
  },
  modelTier: "small",
  requiresAI: false,

  async execute(params, ctx) {
    const p = params as {
      status?: "active" | "paused" | "completed" | "expired" | "all";
    };

    const statusFilter = p.status ?? "active";

    const scouts = await ctx.prisma.scout.findMany({
      where: {
        userId: ctx.userId,
        ...(statusFilter !== "all" ? { status: statusFilter } : {}),
      },
      include: {
        _count: { select: { findings: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    if (scouts.length === 0) {
      const statusLabel = statusFilter === "all" ? "" : ` ${statusFilter}`;
      return {
        success: true,
        data: { scouts: [] },
        message: `You have no${statusLabel} scouts.`,
      };
    }

    const lines = scouts.map((scout) => {
      const findingsLabel =
        scout._count.findings === 1
          ? "1 finding"
          : `${scout._count.findings} findings`;
      const statusBadge = scout.status !== "active" ? ` [${scout.status}]` : "";
      return `- **${scout.name}**${statusBadge} — ${scout.goal.slice(0, 80)}${scout.goal.length > 80 ? "…" : ""} (${findingsLabel})`;
    });

    const heading =
      statusFilter === "all"
        ? `You have ${scouts.length} scout${scouts.length !== 1 ? "s" : ""}:`
        : `You have ${scouts.length} ${statusFilter} scout${scouts.length !== 1 ? "s" : ""}:`;

    return {
      success: true,
      data: { scouts: scouts.map((s) => ({ id: s.id, name: s.name, status: s.status, findingsCount: s._count.findings })) },
      message: `${heading}\n\n${lines.join("\n")}`,
    };
  },
};
