import type { Skill } from "./types.js";
import { validateCreateList } from "@brett/business";

export const createListSkill: Skill = {
  name: "create_list",
  description:
    "Create a new custom list. Use when the user wants to create a new list, project, or category to organize their items.",
  parameters: {
    type: "object",
    properties: {
      name: { type: "string", description: "Name for the new list" },
      colorClass: {
        type: "string",
        description: "Tailwind color class (e.g. 'bg-blue-400', 'bg-emerald-400')",
      },
    },
    required: ["name"],
  },
  modelTier: "small",
  requiresAI: false,

  async execute(params, ctx) {
    const p = params as { name: string; colorClass?: string };

    const validation = validateCreateList({
      name: p.name,
      colorClass: p.colorClass,
    });

    if (!validation.ok) {
      return { success: false, message: validation.error };
    }

    // Check for duplicate
    const existing = await ctx.prisma.list.findFirst({
      where: { userId: ctx.userId, name: validation.data.name },
    });
    if (existing) {
      return { success: false, message: `A list named "${validation.data.name}" already exists.` };
    }

    // New lists go to the top
    await ctx.prisma.list.updateMany({
      where: { userId: ctx.userId },
      data: { sortOrder: { increment: 1 } },
    });

    const list = await ctx.prisma.list.create({
      data: {
        name: validation.data.name,
        colorClass: validation.data.colorClass ?? "bg-blue-400",
        sortOrder: 0,
        userId: ctx.userId,
      },
    });

    return {
      success: true,
      data: { id: list.id, name: list.name, colorClass: list.colorClass },
      displayHint: { type: "confirmation" },
      message: `Created list [${list.name}](brett-nav:/lists/${list.name.toLowerCase().replace(/\s+/g, "-")}).`,
    };
  },
};
