import type { Skill } from "./types.js";

const FEATURE_EXPLANATIONS: Record<string, string> = {
  inbox:
    "The Inbox holds items that haven't been assigned to a list or given a due date. It's your triage zone — items land here first, then you organize them.",
  today:
    "The Today view shows tasks due today plus any overdue items. It's your daily focus — everything that needs attention right now.",
  upcoming:
    "The Upcoming view shows items with future due dates, grouped by time period. Use it to see what's coming up this week, next week, and beyond.",
  lists:
    "Lists are custom collections for organizing items by project, area, or category. Create as many as you need. Items can belong to one list.",
  calendar:
    "The Calendar shows your Google Calendar events integrated into Brett. You can see your schedule, RSVP to events, and add private notes.",
  brett:
    "Brett is your AI assistant. Ask questions, create tasks, search your items, or get a briefing on your day. Brett learns your patterns over time.",
  content:
    "Content items let you save articles, videos, tweets, and other web content. Brett automatically extracts metadata and previews when you save a URL.",
  snooze:
    "Snoozing hides an item until a specific date. It will reappear in your views when the snooze period ends. Great for 'not now, but later' items.",
  "brett's take":
    "Brett's Take is an AI-generated observation about a task or event — context, suggestions, or things to consider. It appears on item details.",
  shortcuts:
    "Use Cmd+K (or Ctrl+K) to open the command bar. From there you can quickly search, create tasks, navigate, and talk to Brett.",
};

export const explainFeatureSkill: Skill = {
  name: "explain_feature",
  description:
    "Explain how a Brett feature works. Use when the user asks 'what is...?', 'how does ... work?', 'help with...', or wants to understand a feature of the app.",
  parameters: {
    type: "object",
    properties: {
      feature: {
        type: "string",
        description:
          "Feature name to explain. Options: inbox, today, upcoming, lists, calendar, brett, content, snooze, brett's take, shortcuts",
      },
    },
    required: ["feature"],
  },
  modelTier: "small",
  requiresAI: false,

  async execute(params, _ctx) {
    const p = params as { feature: string };
    const key = p.feature.toLowerCase().trim();
    const explanation = FEATURE_EXPLANATIONS[key];

    if (!explanation) {
      const available = Object.keys(FEATURE_EXPLANATIONS).join(", ");
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
