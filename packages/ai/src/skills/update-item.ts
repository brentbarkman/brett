import type { Skill } from "./types.js";
import { scopedItems } from "./scoped-queries.js";
import { validateUpdateItem } from "@brett/business";

export const updateItemSkill: Skill = {
  name: "update_item",
  description: "Update fields on an existing item.",
  parameters: {
    type: "object",
    properties: {
      id: { type: "string" },
      title: { type: "string" },
      dueDate: { type: ["string", "null"], description: "ISO 8601 or null to clear" },
      dueDatePrecision: { type: ["string", "null"], enum: ["day", "week", null] },
      notes: { type: ["string", "null"] },
      description: { type: ["string", "null"] },
      status: { type: "string", enum: ["active", "snoozed", "done", "archived"] },
    },
    required: ["id"],
  },
  modelTier: "small",
  requiresAI: false,

  async execute(params, ctx) {
    const p = params as {
      id: string;
      title?: string;
      dueDate?: string | null;
      dueDatePrecision?: string | null;
      notes?: string | null;
      description?: string | null;
      status?: string;
    };

    const validation = validateUpdateItem({
      title: p.title,
      dueDate: p.dueDate,
      dueDatePrecision: p.dueDatePrecision,
      notes: p.notes,
      description: p.description,
      status: p.status,
    });

    if (!validation.ok) {
      return { success: false, message: validation.error };
    }

    const items = scopedItems(ctx.prisma, ctx.userId);
    const updateData: Record<string, unknown> = {};
    const d = validation.data;
    if (d.title !== undefined) updateData.title = d.title;
    if (d.dueDate !== undefined) updateData.dueDate = d.dueDate ? new Date(d.dueDate) : null;
    if (d.dueDatePrecision !== undefined) updateData.dueDatePrecision = d.dueDatePrecision;
    if (d.notes !== undefined) updateData.notes = d.notes;
    if (d.description !== undefined) updateData.description = d.description;
    if (d.status !== undefined) {
      updateData.status = d.status;
      if (d.status === "done") updateData.completedAt = new Date();
    }

    try {
      const updated = await items.updateOwned(p.id, updateData);
      return {
        success: true,
        data: { id: updated.id, title: updated.title },
        displayHint: { type: "confirmation" },
        message: `Updated "${updated.title}".`,
      };
    } catch {
      return { success: false, message: "Item not found." };
    }
  },
};
