import type { Skill } from "./types.js";

const GRADIENT_PAIRS: Array<[string, string]> = [
  ["#f59e0b", "#ef4444"],
  ["#8b5cf6", "#3b82f6"],
  ["#10b981", "#06b6d4"],
  ["#f97316", "#eab308"],
  ["#ec4899", "#8b5cf6"],
  ["#14b8a6", "#22c55e"],
];

/** Convert cadence interval hours to a human-readable string */
function humanizeCadence(hours: number): string {
  if (hours < 1) {
    const minutes = Math.round(hours * 60);
    return `every ${minutes} minute${minutes !== 1 ? "s" : ""}`;
  }
  if (hours < 24) {
    const rounded = Math.round(hours * 10) / 10;
    return `every ${rounded} hour${rounded !== 1 ? "s" : ""}`;
  }
  const days = Math.round((hours / 24) * 10) / 10;
  return `every ${days} day${days !== 1 ? "s" : ""}`;
}

export const createScoutSkill: Skill = {
  name: "create_scout",
  description:
    "Persist a new scout to the database after the user has confirmed all settings. " +
    "Only call this once the conversational flow is complete and all required fields are known.",
  parameters: {
    type: "object",
    properties: {
      name: { type: "string", description: "Scout name" },
      avatarLetter: { type: "string", description: "Single letter for the avatar display" },
      avatarGradientFrom: { type: "string", description: "Hex color for avatar gradient start" },
      avatarGradientTo: { type: "string", description: "Hex color for avatar gradient end" },
      goal: { type: "string", description: "What to monitor — the core objective" },
      context: { type: "string", description: "Additional context or constraints for the scout" },
      sources: {
        type: "array",
        description: "Sources to monitor",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            url: { type: "string" },
          },
          required: ["name"],
        },
      },
      sensitivity: {
        type: "string",
        enum: ["low", "medium", "high"],
        description: "How sensitive the scout is to new findings. Default: medium.",
      },
      cadenceIntervalHours: {
        type: "number",
        description: "How often to check (in hours)",
      },
      cadenceMinIntervalHours: {
        type: "number",
        description: "Minimum interval between checks (in hours). Default: 1.",
      },
      budgetTotal: {
        type: "integer",
        description: "Maximum number of runs per monthly period",
      },
      endDate: {
        type: "string",
        description: "ISO date string after which the scout expires (optional)",
      },
    },
    required: ["name", "goal", "sources", "cadenceIntervalHours", "budgetTotal"],
  },
  modelTier: "medium",
  requiresAI: false,

  async execute(params, ctx) {
    const p = params as {
      name: string;
      avatarLetter?: string;
      avatarGradientFrom?: string;
      avatarGradientTo?: string;
      goal: string;
      context?: string;
      sources: Array<{ name: string; url?: string }>;
      sensitivity?: "low" | "medium" | "high";
      cadenceIntervalHours: number;
      cadenceMinIntervalHours?: number;
      budgetTotal: number;
      endDate?: string;
    };

    // Validate required fields
    if (!p.name?.trim()) {
      return { success: false, message: "Scout name is required." };
    }
    if (!p.goal?.trim()) {
      return { success: false, message: "Scout goal is required." };
    }
    if (!Array.isArray(p.sources) || p.sources.length === 0) {
      return { success: false, message: "At least one source is required." };
    }
    if (!p.cadenceIntervalHours || p.cadenceIntervalHours <= 0) {
      return { success: false, message: "Cadence interval must be a positive number." };
    }
    if (!p.budgetTotal || p.budgetTotal <= 0) {
      return { success: false, message: "Budget total must be a positive integer." };
    }

    // Default avatarLetter to first char of name
    const avatarLetter = p.avatarLetter?.trim().charAt(0) ?? p.name.charAt(0).toUpperCase();

    // Default gradient to a random preset pair
    const randomPair = GRADIENT_PAIRS[Math.floor(Math.random() * GRADIENT_PAIRS.length)]!;
    const avatarGradientFrom = p.avatarGradientFrom ?? randomPair[0];
    const avatarGradientTo = p.avatarGradientTo ?? randomPair[1];

    const cadenceMinIntervalHours = p.cadenceMinIntervalHours ?? 1;

    // nextRunAt = now + cadenceIntervalHours
    const now = new Date();
    const nextRunAt = new Date(now.getTime() + p.cadenceIntervalHours * 60 * 60 * 1000);

    // budgetResetAt = first day of next month
    const budgetResetAt = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    const scout = await ctx.prisma.scout.create({
      data: {
        userId: ctx.userId,
        name: p.name.trim(),
        avatarLetter,
        avatarGradientFrom,
        avatarGradientTo,
        goal: p.goal.trim(),
        context: p.context?.trim() ?? null,
        sources: p.sources,
        sensitivity: p.sensitivity ?? "medium",
        cadenceIntervalHours: p.cadenceIntervalHours,
        cadenceMinIntervalHours,
        cadenceCurrentIntervalHours: p.cadenceIntervalHours,
        budgetTotal: p.budgetTotal,
        budgetUsed: 0,
        budgetResetAt,
        status: "active",
        nextRunAt,
        endDate: p.endDate ? new Date(p.endDate) : null,
      },
    });

    await ctx.prisma.scoutActivity.create({
      data: {
        scoutId: scout.id,
        type: "created",
        description: `Scout created with goal: "${scout.goal.slice(0, 100)}${scout.goal.length > 100 ? "…" : ""}"`,
      },
    });

    const cadenceLabel = humanizeCadence(p.cadenceIntervalHours);

    return {
      success: true,
      data: { id: scout.id, name: scout.name },
      displayHint: { type: "confirmation" },
      message: `Scout "${scout.name}" is live. First check in ${cadenceLabel}.`,
    };
  },
};
