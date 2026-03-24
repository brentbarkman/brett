import type { Skill } from "./types.js";

export const submitFeedbackSkill: Skill = {
  name: "submit_feedback",
  description:
    "Submit feedback about Brett. Use when the user wants to report a bug, suggest a feature, or share feedback about the app.",
  parameters: {
    type: "object",
    properties: {
      feedback: {
        type: "string",
        description: "The feedback text from the user",
      },
    },
    required: ["feedback"],
  },
  modelTier: "small",
  requiresAI: false,

  async execute(params, ctx) {
    const p = params as { feedback: string };

    await ctx.prisma.item.create({
      data: {
        type: "content",
        title: `Feedback: ${p.feedback.slice(0, 80)}${p.feedback.length > 80 ? "..." : ""}`,
        description: p.feedback,
        source: "feedback",
        status: "active",
        userId: ctx.userId,
      },
    });

    return {
      success: true,
      data: {},
      displayHint: { type: "confirmation" },
      message: "Thanks for the feedback! It's been recorded.",
    };
  },
};
