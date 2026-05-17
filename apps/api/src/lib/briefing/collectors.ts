// Signal collectors for the briefing pipeline. Each collector is a pure
// function that runs in parallel before the detector and returns a
// bounded list of candidates. The orchestrator caps the combined bundle
// at 15 signals before sending to the detector. See
// docs/superpowers/specs/2026-05-16-briefing-pipeline-v2-design.md.

import { prisma } from "../prisma.js";
import { getUserDayBounds } from "@brett/business";
import { loadEmbeddingContext } from "../embedding-context.js";
import { getEmbeddingProvider } from "../embedding-provider.js";
import type { Signal, EventRef } from "./types.js";

const MAX_TOTAL_SIGNALS = 15;
const MEETING_CONTEXT_MAX_QUERIES = 4;
const SIGNAL_PRIORITY: Record<Signal["type"], number> = {
  schedule_delta: 100,
  conflict: 90,
  prep_gap: 80,
  inbound: 70,
  overdue_threshold: 60,
  meeting_context: 50,
};

interface CollectContext {
  userId: string;
  timezone: string;
  lastBriefAt: Date | null;
  now: Date;
}

function eventRef(e: {
  id: string;
  title: string;
  startTime: Date;
  endTime: Date;
}): EventRef {
  const durationMin = Math.max(
    1,
    Math.round((e.endTime.getTime() - e.startTime.getTime()) / 60000),
  );
  return {
    id: e.id,
    title: e.title,
    startTime: e.startTime.toISOString(),
    durationMin,
  };
}

// ─── 1. Schedule deltas ──────────────────────────────────────────────────

async function collectScheduleDeltas(ctx: CollectContext): Promise<Signal[]> {
  if (!ctx.lastBriefAt) return [];
  const { startOfDay } = getUserDayBounds(ctx.timezone, ctx.now);
  const horizon = new Date(ctx.now.getTime() + 48 * 60 * 60 * 1000);
  const visibleCalendars = await prisma.calendarList.findMany({
    where: { googleAccount: { userId: ctx.userId }, isVisible: true },
    select: { id: true },
  });
  const calendarIds = visibleCalendars.map((c) => c.id);
  if (calendarIds.length === 0) return [];

  const events = await prisma.calendarEvent.findMany({
    where: {
      userId: ctx.userId,
      calendarListId: { in: calendarIds },
      updatedAt: { gt: ctx.lastBriefAt },
      startTime: { gte: startOfDay, lt: horizon },
    },
    select: {
      id: true,
      title: true,
      startTime: true,
      endTime: true,
      status: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: { updatedAt: "desc" },
    take: 8,
  });

  return events.map((e): Signal => {
    let change: "moved" | "cancelled" | "new" = "moved";
    let details = "rescheduled";
    if (e.status === "cancelled") {
      change = "cancelled";
      details = "cancelled";
    } else if (e.createdAt.getTime() > ctx.lastBriefAt!.getTime()) {
      change = "new";
      details = "new on the calendar";
    }
    return {
      id: `schedule_delta:${e.id}:${change}`,
      type: "schedule_delta",
      event: eventRef(e),
      change,
      details,
      occurredAt: e.updatedAt.toISOString(),
    };
  });
}

// ─── 2. Conflicts ─────────────────────────────────────────────────────────

async function collectConflicts(ctx: CollectContext): Promise<Signal[]> {
  const { startOfDay, endOfDay } = getUserDayBounds(ctx.timezone, ctx.now);
  const tomorrowEnd = new Date(endOfDay.getTime() + 24 * 60 * 60 * 1000);
  const visibleCalendars = await prisma.calendarList.findMany({
    where: { googleAccount: { userId: ctx.userId }, isVisible: true },
    select: { id: true },
  });
  const calendarIds = visibleCalendars.map((c) => c.id);
  if (calendarIds.length === 0) return [];

  const events = await prisma.calendarEvent.findMany({
    where: {
      userId: ctx.userId,
      calendarListId: { in: calendarIds },
      startTime: { gte: startOfDay, lt: tomorrowEnd },
      status: "confirmed",
      myResponseStatus: { not: "observer" },
      isAllDay: false,
    },
    select: { id: true, title: true, startTime: true, endTime: true },
    orderBy: { startTime: "asc" },
  });

  const conflicts: Signal[] = [];
  for (let i = 0; i < events.length - 1; i++) {
    const a = events[i];
    const b = events[i + 1];
    if (a.endTime.getTime() > b.startTime.getTime()) {
      const window = `${a.startTime
        .toISOString()
        .slice(11, 16)}–${a.endTime.toISOString().slice(11, 16)}`;
      conflicts.push({
        id: `conflict:${a.id}:${b.id}`,
        type: "conflict",
        events: [eventRef(a), eventRef(b)],
        window,
      });
      if (conflicts.length >= 4) break;
    }
  }
  return conflicts;
}

// ─── 3. Prep gaps ─────────────────────────────────────────────────────────

async function collectPrepGaps(ctx: CollectContext): Promise<Signal[]> {
  const horizon = new Date(ctx.now.getTime() + 8 * 60 * 60 * 1000);
  const visibleCalendars = await prisma.calendarList.findMany({
    where: { googleAccount: { userId: ctx.userId }, isVisible: true },
    select: { id: true },
  });
  const calendarIds = visibleCalendars.map((c) => c.id);
  if (calendarIds.length === 0) return [];

  const events = await prisma.calendarEvent.findMany({
    where: {
      userId: ctx.userId,
      calendarListId: { in: calendarIds },
      startTime: { gt: ctx.now, lt: horizon },
      status: "confirmed",
      myResponseStatus: { not: "observer" },
      isAllDay: false,
    },
    select: {
      id: true,
      title: true,
      startTime: true,
      endTime: true,
      description: true,
      notes: {
        select: { content: true, updatedAt: true },
        orderBy: { updatedAt: "desc" },
        take: 1,
      },
    },
    orderBy: { startTime: "asc" },
    take: 6,
  });

  const signals: Signal[] = [];
  for (const e of events) {
    const note = e.notes[0];
    const hasNotes = !!(
      (note && note.content && note.content.trim().length > 20) ||
      (e.description && e.description.trim().length > 50)
    );
    if (hasNotes) continue;
    const lastTouchedDays = note
      ? Math.round(
          (ctx.now.getTime() - note.updatedAt.getTime()) /
            (24 * 60 * 60 * 1000),
        )
      : null;
    signals.push({
      id: `prep_gap:${e.id}`,
      type: "prep_gap",
      event: eventRef(e),
      lastTouchedDays,
      hasNotes,
    });
    if (signals.length >= 4) break;
  }
  return signals;
}

// ─── 4. Overdue thresholds ───────────────────────────────────────────────

async function collectOverdueThresholds(ctx: CollectContext): Promise<Signal[]> {
  if (!ctx.lastBriefAt) return [];
  const { startOfDay } = getUserDayBounds(ctx.timezone, ctx.now);

  // Items whose dueDate is in the past — only emit a signal for items
  // that newly crossed 1-day or 3-day boundaries since the last brief.
  const items = await prisma.item.findMany({
    where: {
      userId: ctx.userId,
      type: "task",
      status: "active",
      dueDate: { lt: startOfDay },
    },
    select: { id: true, title: true, dueDate: true },
    orderBy: { dueDate: "asc" },
    take: 50,
  });

  const signals: Signal[] = [];
  for (const item of items) {
    if (!item.dueDate) continue;
    const dayMs = 24 * 60 * 60 * 1000;
    const daysSlippedNow = Math.floor(
      (ctx.now.getTime() - item.dueDate.getTime()) / dayMs,
    );
    const daysSlippedAtLastBrief = Math.floor(
      (ctx.lastBriefAt.getTime() - item.dueDate.getTime()) / dayMs,
    );
    let boundary: "1d" | "3d" | null = null;
    if (daysSlippedAtLastBrief < 3 && daysSlippedNow >= 3) boundary = "3d";
    else if (daysSlippedAtLastBrief < 1 && daysSlippedNow >= 1) boundary = "1d";
    if (!boundary) continue;
    signals.push({
      id: `overdue_threshold:${item.id}:${boundary}`,
      type: "overdue_threshold",
      item: {
        id: item.id,
        title: item.title,
        dueDate: item.dueDate.toISOString(),
      },
      daysSlipped: daysSlippedNow,
      crossedAt: ctx.now.toISOString(),
    });
    if (signals.length >= 6) break;
  }
  return signals;
}

// ─── 5. Inbound (newsletters/emails) ──────────────────────────────────────

async function collectInbound(ctx: CollectContext): Promise<Signal[]> {
  if (!ctx.lastBriefAt) return [];
  const items = await prisma.item.findMany({
    where: {
      userId: ctx.userId,
      type: "content",
      contentType: "newsletter",
      createdAt: { gt: ctx.lastBriefAt },
      status: "active",
    },
    select: {
      id: true,
      title: true,
      contentDescription: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
    take: 4,
  });

  return items.map(
    (i): Signal => ({
      id: `inbound:${i.id}`,
      type: "inbound",
      source: "newsletter",
      subject: i.title,
      summary: (i.contentDescription ?? "").slice(0, 200),
      // No quality score on newsletters today — let the detector judge.
      // Spec calls out measuring threshold on real data post-launch.
      score: 1.0,
      arrivedAt: i.createdAt.toISOString(),
    }),
  );
}

// ─── 6. Meeting context (RAG against past notes) ─────────────────────────

async function collectMeetingContext(ctx: CollectContext): Promise<Signal[]> {
  const horizon = new Date(ctx.now.getTime() + 8 * 60 * 60 * 1000);
  const visibleCalendars = await prisma.calendarList.findMany({
    where: { googleAccount: { userId: ctx.userId }, isVisible: true },
    select: { id: true },
  });
  const calendarIds = visibleCalendars.map((c) => c.id);
  if (calendarIds.length === 0) return [];

  const events = await prisma.calendarEvent.findMany({
    where: {
      userId: ctx.userId,
      calendarListId: { in: calendarIds },
      startTime: { gt: ctx.now, lt: horizon },
      status: "confirmed",
      myResponseStatus: { not: "observer" },
      isAllDay: false,
    },
    select: { id: true, title: true, startTime: true, endTime: true },
    orderBy: { startTime: "asc" },
    take: MEETING_CONTEXT_MAX_QUERIES,
  });
  if (events.length === 0) return [];

  const embeddingProvider = getEmbeddingProvider();
  const signals: Signal[] = [];
  for (const e of events) {
    try {
      const context = await loadEmbeddingContext(
        ctx.userId,
        e.title,
        embeddingProvider,
        prisma,
        1,
      );
      if (!context || context.trim().length < 30) continue;
      signals.push({
        id: `meeting_context:${e.id}`,
        type: "meeting_context",
        event: eventRef(e),
        relevantPriorNote: context.slice(0, 400),
        noteSource: "embedding",
      });
    } catch {
      // RAG failures are non-fatal — skip this event silently.
    }
    if (signals.length >= 4) break;
  }
  return signals;
}

// ─── Orchestrator ─────────────────────────────────────────────────────────

export async function collectAllSignals(
  ctx: CollectContext,
): Promise<Signal[]> {
  const [deltas, conflicts, gaps, overdue, inbound, mctx] = await Promise.all([
    collectScheduleDeltas(ctx).catch(() => []),
    collectConflicts(ctx).catch(() => []),
    collectPrepGaps(ctx).catch(() => []),
    collectOverdueThresholds(ctx).catch(() => []),
    collectInbound(ctx).catch(() => []),
    collectMeetingContext(ctx).catch(() => []),
  ]);

  const all = [...deltas, ...conflicts, ...gaps, ...overdue, ...inbound, ...mctx];

  // Cap at MAX_TOTAL_SIGNALS by intrinsic priority. Within a type,
  // collectors already return their own ordering — sort is stable so
  // that ordering survives.
  all.sort((a, b) => SIGNAL_PRIORITY[b.type] - SIGNAL_PRIORITY[a.type]);
  return all.slice(0, MAX_TOTAL_SIGNALS);
}
