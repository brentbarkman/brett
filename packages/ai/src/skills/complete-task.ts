import type { Skill } from "./types.js";
import { scopedItems } from "./scoped-queries.js";

export const completeTaskSkill: Skill = {
  name: "complete_task",
  description:
    "Mark a task as done. Use when the user says they finished, completed, or are done with a task. Requires the item ID. ALWAYS prefer this over update_item with status='done' — this is the canonical way to complete tasks.",
  parameters: {
    type: "object",
    properties: {
      id: { type: "string", description: "The task ID to complete" },
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
