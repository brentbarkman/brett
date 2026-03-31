import type { Skill } from "./types.js";
import type { Prisma } from "@prisma/client";

export const updateScoutSkill: Skill = {
  name: "update_scout",
  description:
    "Update an existing scout's configuration. Can look up by name (fuzzy) or ID. " +
    "All fields are optional — only provided fields are updated. " +
    "For sources: use addSources to append new sources, or sources to replace all sources.",
  parameters: {
    type: "object",
    properties: {
      nameOrId: {
        type: "string",
        description: "Scout name (case-insensitive partial match) or scout ID. Required to identify which scout to update.",
      },
      name: { type: "string", description: "New scout name (max 100 chars)" },
      goal: { type: "string", description: "Updated monitoring goal (max 5000 chars)" },
      context: { type: ["string", "null"], description: "Updated context (max 5000 chars), or null to clear" },
      addSources: {
        type: "array",
        description: "Sources to ADD to existing sources (does not remove current ones). Each MUST have name and URL.",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            url: { type: "string", description: "Full URL of the source (e.g. https://pubmed.ncbi.nlm.nih.gov)" },
          },
          required: ["name", "url"],
        },
      },
      sources: {
        type: "array",
        description: "REPLACE all sources with this list (removes existing). Use addSources instead if you just want to add. Each MUST have name and URL.",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            url: { type: "string", description: "Full URL of the source" },
          },
          required: ["name", "url"],
        },
      },
      sensitivity: {
        type: "string",
        enum: ["low", "medium", "high"],
        description: "Relevance threshold: low (only critical, 0.7+), medium (default, 0.5+), high (wide net, 0.3+)",
      },
      analysisTier: {
        type: "string",
        enum: ["standard", "deep"],
        description: "Analysis quality: standard (fast/cheap) or deep (thorough, ~10x cost)",
      },
      cadenceIntervalHours: {
        type: "number",
        description: "Base check interval in hours",
      },
      budgetTotal: {
        type: "integer",
        description: "Max runs per month (1-500)",
      },
      endDate: {
        type: ["string", "null"],
        description: "ISO date for expiration, or null to remove",
      },
    },
    required: ["nameOrId"],
  },
  modelTier: "small",
  requiresAI: false,

  async execute(params, ctx) {
    const p = params as {
      nameOrId: string;
      name?: string;
      goal?: string;
      context?: string | null;
      addSources?: Array<{ name: string; url?: string }>;
      sources?: Array<{ name: string; url?: string }>;
      sensitivity?: "low" | "medium" | "high";
      analysisTier?: "standard" | "deep";
      cadenceIntervalHours?: number;
      budgetTotal?: number;
      endDate?: string | null;
    };

    if (!p.nameOrId?.trim()) {
      return { success: false, message: "nameOrId is required to identify the scout." };
    }

    // Look up scout — try ID first, then fuzzy name match
    let scout = await ctx.prisma.scout.findFirst({
      where: { id: p.nameOrId, userId: ctx.userId },
    });

    if (!scout) {
      // Fuzzy name match — case-insensitive contains
      const candidates = await ctx.prisma.scout.findMany({
        where: {
          userId: ctx.userId,
          name: { contains: p.nameOrId, mode: "insensitive" },
          status: { not: "completed" },
        },
        take: 5,
      });

      if (candidates.length === 0) {
        return { success: false, message: `No scout found matching "${p.nameOrId}".` };
      }
      if (candidates.length > 1) {
        const names = candidates.map((s) => `"${s.name}"`).join(", ");
        return { success: false, message: `Multiple scouts match "${p.nameOrId}": ${names}. Be more specific.` };
      }
      scout = candidates[0]!;
    }

    // Build update data — only include provided fields
    const data: Record<string, unknown> = {};
    const changes: string[] = [];

    if (p.name !== undefined) {
      if (!p.name.trim()) return { success: false, message: "Name cannot be empty." };
      if (p.name.length > 100) return { success: false, message: "Name must be 100 characters or fewer." };
      data.name = p.name.trim();
      changes.push(`name → "${p.name.trim()}"`);
    }

    if (p.goal !== undefined) {
      if (!p.goal.trim()) return { success: false, message: "Goal cannot be empty." };
      if (p.goal.length > 5000) return { success: false, message: "Goal must be 5000 characters or fewer." };
      data.goal = p.goal.trim();
      changes.push("goal updated");
    }

    if (p.context !== undefined) {
      if (p.context === null) {
        data.context = null;
        changes.push("context cleared");
      } else {
        if (p.context.length > 5000) return { success: false, message: "Context must be 5000 characters or fewer." };
        data.context = p.context.trim();
        changes.push("context updated");
      }
    }

    if (p.addSources !== undefined) {
      if (!Array.isArray(p.addSources)) return { success: false, message: "addSources must be an array." };
      const existing = (scout.sources ?? []) as unknown as Array<{ name: string; url?: string }>;
      const combined = [...existing, ...p.addSources];
      if (combined.length > 20) return { success: false, message: `Would have ${combined.length} sources (max 20). Remove some first.` };
      data.sources = combined;
      changes.push(`added ${p.addSources.length} source${p.addSources.length !== 1 ? "s" : ""}: ${p.addSources.map((s) => s.name).join(", ")}`);
    } else if (p.sources !== undefined) {
      if (!Array.isArray(p.sources) || p.sources.length === 0) return { success: false, message: "Sources array cannot be empty." };
      if (p.sources.length > 20) return { success: false, message: "Maximum of 20 sources allowed." };
      data.sources = p.sources;
      changes.push(`sources replaced (${p.sources.length} total)`);
    }

    if (p.sensitivity !== undefined) {
      data.sensitivity = p.sensitivity;
      changes.push(`sensitivity → ${p.sensitivity}`);
    }

    if (p.analysisTier !== undefined) {
      data.analysisTier = p.analysisTier;
      changes.push(`analysis tier → ${p.analysisTier}`);
    }

    if (p.cadenceIntervalHours !== undefined) {
      if (p.cadenceIntervalHours <= 0) return { success: false, message: "Cadence must be positive." };
      data.cadenceIntervalHours = p.cadenceIntervalHours;
      data.cadenceCurrentIntervalHours = p.cadenceIntervalHours;
      changes.push(`cadence → ${p.cadenceIntervalHours}h`);
    }

    if (p.budgetTotal !== undefined) {
      if (p.budgetTotal <= 0 || p.budgetTotal > 500) return { success: false, message: "Budget must be 1-500." };
      data.budgetTotal = p.budgetTotal;
      changes.push(`budget → ${p.budgetTotal}/month`);
    }

    if (p.endDate !== undefined) {
      if (p.endDate === null) {
        data.endDate = null;
        changes.push("end date cleared");
      } else {
        data.endDate = new Date(p.endDate);
        changes.push(`end date → ${p.endDate}`);
      }
    }

    if (changes.length === 0) {
      return { success: false, message: "No changes provided. Specify at least one field to update." };
    }

    // Apply update
    await ctx.prisma.scout.update({
      where: { id: scout.id },
      data,
    });

    // Log activity
    await ctx.prisma.scoutActivity.create({
      data: {
        scoutId: scout.id,
        type: "config_changed",
        description: changes.join("; "),
        metadata: { changes, updatedBy: "brett" } as unknown as Prisma.InputJsonValue,
      },
    });

    return {
      success: true,
      data: { id: scout.id, name: (data.name as string) ?? scout.name },
      displayHint: { type: "confirmation" },
      message: `Updated "${(data.name as string) ?? scout.name}": ${changes.join(", ")}.`,
    };
  },
};
