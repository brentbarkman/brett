import { createGranolaClient } from "../mcp/granola.js";
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
      date: {
        type: "string",
        description: "Date to retrieve meeting notes for (ISO format)",
      },
    },
  },
  modelTier: "small",
  requiresAI: false,

  async execute(params, _ctx) {
    const granolaClient = createGranolaClient();

    if (!granolaClient) {
      return {
        success: true,
        data: { placeholder: true },
        displayHint: { type: "text" },
        message:
          "MCP integration coming soon. This will connect to meeting note services to retrieve transcripts and summaries.",
      };
    }

    const date = (params as Record<string, unknown>).date as string | undefined;
    const notes = await granolaClient.getMeetingNotes(date ?? new Date().toISOString());

    if (!notes) {
      return {
        success: true,
        data: { notes: null },
        displayHint: { type: "text" },
        message: "No meeting notes found.",
      };
    }

    return {
      success: true,
      data: { notes },
      displayHint: { type: "text" },
      message: notes,
    };
  },
};
