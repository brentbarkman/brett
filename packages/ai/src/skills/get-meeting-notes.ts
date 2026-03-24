import type { Skill } from "./types.js";

export const getMeetingNotesSkill: Skill = {
  name: "get_meeting_notes",
  description:
    "Retrieve meeting notes from connected services via MCP integration. Use when the user asks for meeting notes, transcripts, or meeting summaries. Currently a placeholder — MCP integration coming soon.",
  parameters: {
    type: "object",
    properties: {
      eventId: {
        type: "string",
        description: "Calendar event ID to get meeting notes for",
      },
      query: {
        type: "string",
        description: "Search query for meeting notes",
      },
    },
  },
  modelTier: "small",
  requiresAI: false,

  async execute(_params, _ctx) {
    return {
      success: true,
      data: { placeholder: true },
      displayHint: { type: "text" },
      message:
        "MCP integration coming soon. This will connect to meeting note services to retrieve transcripts and summaries.",
    };
  },
};
