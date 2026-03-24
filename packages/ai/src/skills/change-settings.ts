import type { Skill } from "./types.js";

export const changeSettingsSkill: Skill = {
  name: "change_settings",
  description:
    "Change user settings. Currently limited to toggling the active AI provider. Use when the user asks to switch AI models, change providers, or adjust their AI settings.",
  parameters: {
    type: "object",
    properties: {
      aiProvider: {
        type: "string",
        enum: ["anthropic", "openai", "google"],
        description: "The AI provider to switch to",
      },
    },
    required: ["aiProvider"],
  },
  modelTier: "small",
  requiresAI: false,

  async execute(params, ctx) {
    const p = params as { aiProvider: string };

    const validProviders = new Set(["anthropic", "openai", "google"]);
    if (!validProviders.has(p.aiProvider)) {
      return { success: false, message: `Invalid provider. Choose from: anthropic, openai, google.` };
    }

    // Deactivate all, then activate the target provider
    await ctx.prisma.userAIConfig.updateMany({
      where: { userId: ctx.userId },
      data: { isActive: false },
    });

    const config = await ctx.prisma.userAIConfig.findFirst({
      where: { userId: ctx.userId, provider: p.aiProvider },
    });

    if (!config) {
      return {
        success: false,
        message: `No API key configured for ${p.aiProvider}. Add one in Settings first.`,
      };
    }

    await ctx.prisma.userAIConfig.update({
      where: { id: config.id },
      data: { isActive: true },
    });

    return {
      success: true,
      data: { aiProvider: p.aiProvider },
      displayHint: { type: "confirmation" },
      message: `Switched AI provider to ${p.aiProvider}.`,
    };
  },
};
