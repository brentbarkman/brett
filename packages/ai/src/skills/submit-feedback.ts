import type { Skill } from "./types.js";

export const submitFeedbackSkill: Skill = {
  name: "submit_feedback",
  description: "Submit user feedback about Brett — bug reports, feature requests, UX complaints, or praise about the assistant/app itself. Use when the user says things like 'this is buggy', 'I wish it did X', 'this confused me', or 'this is great'. Do NOT use for the user's own tasks or todo items.",
  parameters: {
    type: "object",
    properties: {
      feedback: { type: "string" },
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
