import type { Skill } from "./types.js";
import { scopedEvents, scopedItems } from "./scoped-queries.js";
import { getTodayUTC, itemToThing } from "@brett/business";

export const upNextSkill: Skill = {
  name: "up_next",
  description: "Overview of what to focus on next (calendar + tasks).",
  parameters: {
    type: "object",
    properties: {},
  },
  modelTier: "small",
  requiresAI: false,

  async execute(_params, ctx) {
    const now = new Date();
    const todayStart = getTodayUTC(now);
    // Include tasks due through end of tomorrow (2-day horizon)
    const horizonEnd = new Date(todayStart.getTime() + 2 * 86400000 - 1);

    // Fetch next calendar event
    const events = await scopedEvents(ctx.prisma, ctx.userId);
    const nextEvents = await events.findMany({
      where: {
        startTime: { gte: now },
        isAllDay: false,
      },
      orderBy: { startTime: "asc" },
      take: 1,
    });

    // Fetch overdue + due today + due tomorrow tasks
    const items = scopedItems(ctx.prisma, ctx.userId);
    const taskResults = await items.findMany({
      where: {
        status: "active",
        dueDate: { lte: horizonEnd },
      },
      orderBy: { dueDate: "asc" },
    });

    const withLists = taskResults.length > 0
      ? await ctx.prisma.item.findMany({
          where: { id: { in: taskResults.map((r) => r.id) }, userId: ctx.userId },
          include: { list: { select: { name: true } } },
          orderBy: { dueDate: "asc" },
        })
      : [];

    const things = withLists.map((i) => {
      const thing = itemToThing(i as any, now);
      return { ...thing, contentType: (i as any).contentType ?? null };
    });

    const nextEvent = nextEvents.length > 0 ? nextEvents[0] : null;

    // Build combined message
    const parts: string[] = [];

    if (things.length > 0) {
      const taskSummary = things.slice(0, 5).map((t: any) => `[${t.title}](brett-item:${t.id})`).join(", ");
      parts.push(`You have ${things.length} task${things.length === 1 ? "" : "s"} due soon: ${taskSummary}.`);
    }

    if (nextEvent) {
      parts.push(`Next event: [${nextEvent.title}](brett-event:${nextEvent.id}) at ${nextEvent.startTime.toLocaleTimeString()}.`);
    }

    if (parts.length === 0) {
      parts.push("Nothing coming up — you're all clear.");
    }

    return {
      success: true,
      data: {
        event: nextEvent ? {
          id: nextEvent.id,
          title: nextEvent.title,
          startTime: nextEvent.startTime.toISOString(),
          endTime: nextEvent.endTime.toISOString(),
          location: nextEvent.location,
          meetingLink: nextEvent.meetingLink,
        } : null,
        items: things,
      },
      displayHint: { type: things.length > 0 ? "list" : "detail" },
      message: parts.join(" "),
    };
  },
};
