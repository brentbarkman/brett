import type { Skill } from "./types.js";
import { scopedItems } from "./scoped-queries.js";

export const snoozeItemSkill: Skill = {
  name: "snooze_item",
  description:
    "Snooze an item until a specific date. Use when the user wants to hide or defer an item until later. Sets status to 'snoozed' and snoozedUntil date.",
  parameters: {
    type: "object",
    properties: {
      id: { type: "string", description: "The item ID to snooze" },
      snoozedUntil: {
        type: "string",
        description: "ISO 8601 date string for when the item should reappear",
      },
    },
    required: ["id", "snoozedUntil"],
  },
  modelTier: "small",
  requiresAI: false,

  async execute(params, ctx) {
    const p = params as { id: string; snoozedUntil: string };
    const items = scopedItems(ctx.prisma, ctx.userId);

    const until = new Date(p.snoozedUntil);
    if (isNaN(until.getTime())) {
      return { success: false, message: "Invalid snoozedUntil date." };
    }

    try {
      const updated = await items.updateOwned(p.id, {
        status: "snoozed",
        snoozedUntil: until,
      });
      return {
        success: true,
        data: { id: updated.id, title: updated.title, snoozedUntil: until.toISOString() },
        displayHint: { type: "confirmation" },
        message: `Snoozed "${updated.title}" until ${until.toLocaleDateString()}.`,
      };
    } catch {
      return { success: false, message: "Item not found." };
    }
  },
};
