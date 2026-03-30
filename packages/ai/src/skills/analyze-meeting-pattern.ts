import type { AIProviderName } from "@brett/types";
import type { Skill } from "./types.js";
import { resolveModel } from "../router.js";

export const analyzeMeetingPatternSkill: Skill = {
  name: "analyze_meeting_pattern",
  description:
    "Analyze patterns across recurring meetings. Use when the user asks about trends, recurring topics, or patterns in a meeting series.",
  parameters: {
    type: "object",
    properties: {
      meetingTitle: {
        type: "string",
        description: "Meeting title to search for (matches recurring series)",
      },
      calendarEventId: {
        type: "string",
        description:
          "Calendar event ID to identify the series (uses the event's title to find all instances)",
      },
    },
    required: ["meetingTitle"],
  },
  modelTier: "large",
  requiresAI: true,

  async execute(params, ctx) {
    const p = params as {
      meetingTitle: string;
      calendarEventId?: string;
    };

    if (!ctx.provider) {
      return {
        success: false,
        message:
          "AI provider not available. Meeting pattern analysis requires an AI provider to be configured.",
      };
    }

    // Find all meetings matching the title
    const meetings = await ctx.prisma.meetingNote.findMany({
      where: {
        userId: ctx.userId,
        title: { contains: p.meetingTitle, mode: "insensitive" },
      },
      orderBy: { meetingStartedAt: "asc" },
    });

    if (meetings.length < 2) {
      return {
        success: true,
        data: { meetingCount: meetings.length },
        displayHint: { type: "text" },
        message:
          meetings.length === 0
            ? `No meetings found matching "${p.meetingTitle}".`
            : `Only one meeting found for "${p.meetingTitle}". Need at least 2 meetings to analyze patterns.`,
      };
    }

    // Build context from each meeting
    const meetingContext = meetings
      .map((m) => {
        const date = m.meetingStartedAt.toISOString().split("T")[0];
        const actionItems = Array.isArray(m.actionItems)
          ? (m.actionItems as Array<{ title: string }>)
              .map((ai) => `  - ${ai.title}`)
              .join("\n")
          : "  (none)";

        return [
          `## ${m.title} (${date})`,
          "",
          m.summary ?? "_No summary_",
          "",
          "**Action items:**",
          actionItems,
        ].join("\n");
      })
      .join("\n\n---\n\n");

    const systemPrompt = [
      "You are analyzing a series of recurring meetings to identify patterns and trends.",
      "Be concise and actionable. Use markdown formatting.",
      "Focus on:",
      "1. **Recurring topics** — themes that come up repeatedly",
      "2. **Stale action items** — items mentioned across multiple meetings without resolution",
      "3. **Attendance trends** — if attendee data is available, note any patterns",
      "4. **Notable shifts** — topics that appeared, disappeared, or changed in emphasis over time",
      "",
      "If the data is sparse (e.g., missing summaries), say so and work with what's available.",
    ].join("\n");

    const userMessage = [
      `Analyze patterns across these ${meetings.length} instances of "${p.meetingTitle}":`,
      "",
      meetingContext,
    ].join("\n");

    // Call the AI provider and collect the response
    const model = resolveModel(
      ctx.provider.name as AIProviderName,
      "medium"
    );

    let analysis = "";
    for await (const chunk of ctx.provider.chat({
      model,
      messages: [{ role: "user", content: userMessage }],
      system: systemPrompt,
      temperature: 0.3,
      maxTokens: 2048,
    })) {
      if (chunk.type === "text") {
        analysis += chunk.content;
      }
    }

    if (!analysis) {
      return {
        success: false,
        message: "AI analysis returned empty. Please try again.",
      };
    }

    return {
      success: true,
      data: { meetingCount: meetings.length, title: p.meetingTitle },
      displayHint: { type: "text" },
      message: `**Pattern analysis for "${p.meetingTitle}"** (${meetings.length} meetings):\n\n${analysis}`,
    };
  },
};
