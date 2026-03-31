import type { Skill } from "./types.js";
import { humanizeCadence } from "@brett/utils";

const GRADIENT_PAIRS: Array<[string, string]> = [
  ["#f59e0b", "#ef4444"],
  ["#8b5cf6", "#3b82f6"],
  ["#10b981", "#06b6d4"],
  ["#f97316", "#eab308"],
  ["#ec4899", "#8b5cf6"],
  ["#14b8a6", "#22c55e"],
];

export const createScoutSkill: Skill = {
  name: "create_scout",
  description:
    "Persist a new scout to the database after the user has confirmed all settings. " +
    "Only call this once the conversational flow is complete and all required fields are known.",
  parameters: {
    type: "object",
    properties: {
      name: { type: "string", description: "Short, descriptive scout name (max 100 chars). Example: 'AI Regulation Tracker'" },
      avatarLetter: { type: "string", description: "Single letter for the avatar display" },
      avatarGradientFrom: { type: "string", description: "Hex color for avatar gradient start" },
      avatarGradientTo: { type: "string", description: "Hex color for avatar gradient end" },
      goal: { type: "string", description: "What to monitor — the core objective (max 5000 chars). Be specific about what constitutes a relevant finding." },
      context: { type: "string", description: "Additional context or constraints for the scout (max 5000 chars). Include domain expertise or filtering criteria." },
      sources: {
        type: "array",
        description: "Sources to monitor (max 20). Each source needs a name and optional URL. Example: [{name: 'TechCrunch', url: 'https://techcrunch.com'}]",
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
        description: "Relevance threshold. 'low' = only highly relevant (0.7+), 'medium' = moderately relevant (0.5+), 'high' = cast a wide net (0.3+). Default: medium.",
      },
      cadenceIntervalHours: {
        type: "number",
        description: "Base check interval in hours. Guidelines: breaking news = 1-4h, daily monitoring = 12-24h, weekly digest = 168h. Min 0.25 (15 min).",
      },
      cadenceMinIntervalHours: {
        type: "number",
        description: "Floor for adaptive cadence (hours). Prevents checking too frequently even when elevating. Min 0.25. Default: 1.",
      },
      budgetTotal: {
        type: "integer",
        description: "Max runs per month (1-500). A 24h cadence scout needs ~30/month. Add buffer for adaptive elevation.",
      },
      endDate: {
        type: "string",
        description: "ISO date string after which the scout expires (optional). Use for time-bounded monitoring (e.g., event tracking).",
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
    if (p.name.length > 100) {
      return { success: false, message: "Scout name must be 100 characters or fewer." };
    }
    if (!p.goal?.trim()) {
      return { success: false, message: "Scout goal is required." };
    }
    if (p.goal.length > 5000) {
      return { success: false, message: "Scout goal must be 5000 characters or fewer." };
    }
    if (p.context && p.context.length > 5000) {
      return { success: false, message: "Scout context must be 5000 characters or fewer." };
    }
    if (!Array.isArray(p.sources) || p.sources.length === 0) {
      return { success: false, message: "At least one source is required." };
    }
    if (p.sources.length > 20) {
      return { success: false, message: "Maximum of 20 sources allowed." };
    }
    if (!p.cadenceIntervalHours || p.cadenceIntervalHours <= 0) {
      return { success: false, message: "Cadence interval must be a positive number." };
    }
    if (p.cadenceMinIntervalHours !== undefined && p.cadenceMinIntervalHours < 0.25) {
      return { success: false, message: "Minimum cadence interval must be at least 0.25 hours (15 minutes)." };
    }
    if (!p.budgetTotal || p.budgetTotal <= 0) {
      return { success: false, message: "Budget total must be a positive integer." };
    }
    if (p.budgetTotal > 500) {
      return { success: false, message: "Budget total must be 500 or fewer runs per month." };
    }

    // Check active scouts limit
    const activeCount = await ctx.prisma.scout.count({
      where: { userId: ctx.userId, status: { not: "completed" } },
    });
    if (activeCount >= 20) {
      return { success: false, message: "Maximum of 20 active scouts allowed. Please complete or remove an existing scout first." };
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

    // budgetResetAt = first day of next month (UTC)
    const budgetResetAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

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
