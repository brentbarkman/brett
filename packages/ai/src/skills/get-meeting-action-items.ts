import type { Skill } from "./types.js";
import { validateCreateItem } from "@brett/business";

export const getMeetingActionItemsSkill: Skill = {
  name: "get_meeting_action_items",
  description:
    "Get action items from a meeting. Use when the user asks for action items, todos, or follow-ups from a specific meeting. Can also create them as tasks.",
  parameters: {
    type: "object",
    properties: {
      calendarEventId: {
        type: "string",
        description: "Calendar event ID to look up action items for",
      },
      meetingTitle: {
        type: "string",
        description: "Meeting title to search for (case-insensitive)",
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

    // Find the meeting
    let meeting = await findMeeting(ctx, p);

    // On-demand fallback: if no meeting found, check if user has a Granola account
    // and suggest waiting for sync rather than over-engineering a cross-package import
    if (!meeting) {
      const hasGranola = await ctx.prisma.granolaAccount.findUnique({
        where: { userId: ctx.userId },
      });

      if (hasGranola) {
        return {
          success: true,
          data: null,
          displayHint: { type: "text" },
          message:
            "I couldn't find that meeting yet. It may not have synced from Granola. " +
            "Meetings sync automatically every few minutes — try again shortly.",
        };
      }

      return {
        success: true,
        data: null,
        displayHint: { type: "text" },
        message: "No matching meeting found.",
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
            granolaMeetingId: meeting.id,
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

    // List action items without creating
    const date = meeting.meetingStartedAt.toISOString().split("T")[0];
    const itemLines = actionItems
      .map((item) => {
        const due = item.dueDate ? ` (due ${item.dueDate})` : "";
        const assignee = item.assignee ? ` — ${item.assignee}` : "";
        return `- ${item.title}${due}${assignee}`;
      })
      .join("\n");

    return {
      success: true,
      data: {
        meetingId: meeting.id,
        title: meeting.title,
        actionItemCount: actionItems.length,
      },
      displayHint: { type: "text" },
      message: `**Action items from ${meeting.title}** (${date}):\n\n${itemLines}\n\n_Say "create tasks from this meeting" to turn these into tasks._`,
    };
  },
};

// ─── Helpers ───

interface ActionItem {
  title: string;
  dueDate?: string;
  assignee?: string;
}

interface MeetingRecord {
  id: string;
  title: string;
  actionItems: unknown;
  meetingStartedAt: Date;
}

async function findMeeting(
  ctx: { prisma: import("@prisma/client").PrismaClient; userId: string },
  p: { calendarEventId?: string; meetingTitle?: string }
): Promise<MeetingRecord | null> {
  if (p.calendarEventId) {
    return ctx.prisma.granolaMeeting.findFirst({
      where: { calendarEventId: p.calendarEventId, userId: ctx.userId },
    });
  }

  if (p.meetingTitle) {
    return ctx.prisma.granolaMeeting.findFirst({
      where: {
        userId: ctx.userId,
        title: { contains: p.meetingTitle, mode: "insensitive" },
      },
      orderBy: { meetingStartedAt: "desc" },
    });
  }

  return null;
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
