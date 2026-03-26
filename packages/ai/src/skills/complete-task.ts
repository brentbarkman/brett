import type { Skill } from "./types.js";
import { scopedItems } from "./scoped-queries.js";

export const completeTaskSkill: Skill = {
  name: "complete_task",
  description: "Mark a task as done.",
  parameters: {
    type: "object",
    properties: {
      id: { type: "string" },
    },
    required: ["id"],
  },
  modelTier: "small",
  requiresAI: false,

  async execute(params, ctx) {
    const p = params as { id: string };
    const items = scopedItems(ctx.prisma, ctx.userId);

    try {
      const updated = await items.updateOwned(p.id, {
        status: "done",
        completedAt: new Date(),
      });
      return {
        success: true,
        data: { id: updated.id, title: updated.title },
        displayHint: { type: "confirmation" },
        message: `Completed [${updated.title}](brett-item:${updated.id}).`,
      };
    } catch {
      return { success: false, message: "Task not found." };
    }
  },
};
