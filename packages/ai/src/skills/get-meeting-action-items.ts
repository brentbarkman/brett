import type { Skill } from "./types.js";
import { validateCreateItem } from "@brett/business";
import { findMeetingByQuery, findMeetingsByQuery } from "./meeting-search.js";

export const getMeetingActionItemsSkill: Skill = {
  name: "get_meeting_action_items",
  description:
    "Get action items from meeting notes. ALWAYS use this (not search_things) when the user mentions a meeting, a person they met with, or asks about action items/next steps/follow-ups from a meeting. Searches by person name, meeting title, topic, calendar event, and attendees.",
  parameters: {
    type: "object",
    properties: {
      calendarEventId: {
        type: "string",
        description: "Calendar event ID to look up action items for",
      },
      meetingTitle: {
        type: "string",
        description: "Person name, meeting title, or topic to search for (e.g. 'Dan Cole', 'sprint planning', 'adobe chat'). Searches titles, calendar events, and attendees.",
      },
      createTasks: {
        type: "boolean",
        description: "If true, create tasks for each action item",
      },
    },
  },
  modelTier: "small",
  requiresAI: false,

  async execute(params, ctx) {
    const p = params as {
      calendarEventId?: string;
      meetingTitle?: string;
      createTasks?: boolean;
    };

    // Find the meeting(s)
    console.log("[get_meeting_action_items] called with:", JSON.stringify(p));
    const { meeting, otherMatches } = await findMeetings(ctx, p);

    if (!meeting) {
      const hasMeetingNotes = await ctx.prisma.granolaAccount.findUnique({
        where: { userId: ctx.userId },
      });

      return {
        success: true,
        data: null,
        displayHint: { type: "text" },
        message: hasMeetingNotes
          ? "No matching meeting found. It may not have synced yet — meetings sync automatically every few minutes."
          : "No matching meeting found. Connect a meeting notes provider in Settings to sync meetings.",
      };
    }

    // Parse action items from the JSON column
    const actionItems = parseActionItems(meeting.actionItems);

    if (actionItems.length === 0) {
      return {
        success: true,
        data: { meetingId: meeting.id, title: meeting.title },
        displayHint: { type: "text" },
        message: `No action items recorded for **${meeting.title}**.`,
      };
    }

    // Create tasks if requested
    if (p.createTasks) {
      const created: Array<{ id: string; title: string }> = [];

      for (const item of actionItems) {
        const validation = validateCreateItem({
          type: "task",
          title: item.title,
          dueDate: item.dueDate,
          source: "Granola",
        });

        if (!validation.ok) continue;

        const task = await ctx.prisma.item.create({
          data: {
            type: "task",
            title: validation.data.title,
            dueDate: validation.data.dueDate
              ? new Date(validation.data.dueDate)
              : null,
            status: "active",
            source: "Granola",
            meetingNoteId: meeting.id,
            userId: ctx.userId,
          },
        });

        created.push({ id: task.id, title: task.title });
      }

      if (created.length === 0) {
        return {
          success: true,
          data: { meetingId: meeting.id },
          displayHint: { type: "text" },
          message: "No valid action items could be created as tasks.",
        };
      }

      const taskLines = created
        .map((t) => `- [${t.title}](brett-item:${t.id})`)
        .join("\n");

      return {
        success: true,
        data: { created },
        displayHint: { type: "confirmation" },
        message: `Created ${created.length} task${created.length === 1 ? "" : "s"} from **${meeting.title}**:\n\n${taskLines}`,
      };
    }

    // Fetch linked Item records (actual tasks) for clickable links
    const linkedTasks = await ctx.prisma.item.findMany({
      where: { meetingNoteId: meeting.id, userId: ctx.userId, source: "Granola" },
      select: { id: true, title: true, status: true, dueDate: true },
      orderBy: { createdAt: "asc" },
    });

    const date = meeting.meetingStartedAt.toISOString().split("T")[0];

    // Prefer linked tasks (clickable), fall back to raw action items
    const itemLines = linkedTasks.length > 0
      ? linkedTasks.map((t) => {
          const due = t.dueDate ? ` (due ${t.dueDate.toISOString().split("T")[0]})` : "";
          const done = t.status === "done" ? " ~~" : "";
          const doneEnd = t.status === "done" ? "~~" : "";
          return `- ${done}[${t.title}](brett-item:${t.id})${doneEnd}${due}`;
        }).join("\n")
      : actionItems.map((item) => {
          const due = item.dueDate ? ` (due ${item.dueDate})` : "";
          return `- ${item.title}${due}`;
        }).join("\n");

    const otherMeetingsNote = otherMatches.length > 0
      ? `\n\n_Also found: ${otherMatches.map((m) => `**${m.title}** (${m.meetingStartedAt.toISOString().split("T")[0]})`).join(", ")}_`
      : "";

    return {
      success: true,
      data: {
        meetingId: meeting.id,
        title: meeting.title,
        actionItemCount: linkedTasks.length || actionItems.length,
      },
      displayHint: { type: "text" },
      message: `**Action items from ${meeting.calendarEventId ? `[${meeting.title}](brett-event:${meeting.calendarEventId})` : meeting.title}** (${date}):\n\n${itemLines}${otherMeetingsNote}`,
    };
  },
};

// ─── Helpers ───

interface ActionItem {
  title: string;
  dueDate?: string;
  assignee?: string;
}

type MeetingRecord = { id: string; calendarEventId: string | null; title: string; actionItems: unknown; meetingStartedAt: Date };

async function findMeetings(
  ctx: { prisma: import("@brett/api-core").PrismaClient; userId: string },
  p: { calendarEventId?: string; meetingTitle?: string }
): Promise<{ meeting: MeetingRecord | null; otherMatches: MeetingRecord[] }> {
  if (p.calendarEventId) {
    const meeting = await ctx.prisma.meetingNote.findFirst({
      where: { calendarEventId: p.calendarEventId, userId: ctx.userId },
    });
    return { meeting, otherMatches: [] };
  }
  if (p.meetingTitle) {
    const all = await findMeetingsByQuery(ctx.prisma, ctx.userId, p.meetingTitle, 5);
    return { meeting: all[0] ?? null, otherMatches: all.slice(1) };
  }
  return { meeting: null, otherMatches: [] };
}

function parseActionItems(raw: unknown): ActionItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (item): item is ActionItem =>
      typeof item === "object" &&
      item !== null &&
      typeof (item as Record<string, unknown>).title === "string"
  );
}
