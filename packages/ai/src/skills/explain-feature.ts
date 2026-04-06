import type { Skill, SkillContext } from "./types.js";

function getFeatureExplanations(assistantName: string): Record<string, string> {
  return {
    inbox:
      "The Inbox holds items that haven't been assigned to a list or given a due date. It's your triage zone — items land here first, then you organize them.",
    today:
      "The Today view shows tasks due today plus any overdue items. It's your daily focus — everything that needs attention right now.",
    upcoming:
      "The Upcoming view shows items with future due dates, grouped by time period. Use it to see what's coming up this week, next week, and beyond.",
    lists:
      "Lists are custom collections for organizing items by project, area, or category. Create as many as you need. Items can belong to one list.",
    calendar:
      `The Calendar shows your Google Calendar events integrated into ${assistantName}. You can see your schedule, RSVP to events, and add private notes.`,
    brett:
      `${assistantName} is your AI assistant. Ask questions, create tasks, search your items, or get a briefing on your day. ${assistantName} learns your patterns over time.`,
    content:
      `Content items let you save articles, videos, tweets, and other web content. ${assistantName} automatically extracts metadata and previews when you save a URL.`,
    snooze:
      "Snoozing hides an item until a specific date. It will reappear in your views when the snooze period ends. Great for 'not now, but later' items.",
    "brett's take":
      `${assistantName}'s Take is an AI-generated observation about a task or event — context, suggestions, or things to consider. It appears on item details.`,
    shortcuts:
      `Use Cmd+K (or Ctrl+K) to open the command bar. From there you can quickly search, create tasks, navigate, and talk to ${assistantName}.`,
  };
}

export const explainFeatureSkill: Skill = {
  name: "explain_feature",
  description: "Explain a Brett feature.",
  parameters: {
    type: "object",
    properties: {
      feature: { type: "string", enum: ["inbox", "today", "upcoming", "lists", "calendar", "brett", "content", "snooze", "brett's take", "shortcuts"] },
    },
    required: ["feature"],
  },
  modelTier: "small",
  requiresAI: false,

  async execute(params, ctx) {
    const p = params as { feature: string };
    const key = p.feature.toLowerCase().trim();
    // TODO: thread assistantName through SkillContext so this is user-specific
    const assistantName = (ctx as SkillContext & { assistantName?: string }).assistantName ?? "Brett";
    const explanations = getFeatureExplanations(assistantName);
    const explanation = explanations[key];

    if (!explanation) {
      const available = Object.keys(explanations).join(", ");
      return {
        success: true,
        data: { available },
        displayHint: { type: "text" },
        message: `I can explain these features: ${available}. Which one are you curious about?`,
      };
    }

    return {
      success: true,
      data: { feature: key, explanation },
      displayHint: { type: "text" },
      message: explanation,
    };
  },
};
