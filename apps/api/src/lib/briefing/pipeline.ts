// Two-stage briefing pipeline orchestrator. See
// docs/superpowers/specs/2026-05-16-briefing-pipeline-v2-design.md.

import { Prisma } from "@brett/api-core";
import type { AIProviderName } from "@brett/types";
import {
  getBriefingDetectorPrompt,
  getBriefingWriterPrompt,
  resolveModel,
  type AIProvider,
} from "@brett/ai";
import { prisma } from "../prisma.js";
import { publishSSE } from "../sse.js";
import { collectAllSignals } from "./collectors.js";
import {
  buildDetectorUserMessage,
  buildWriterUserMessage,
} from "./prompt-messages.js";
import { pickEmptyTemplate } from "./templates.js";
import type {
  DetectorInput,
  DetectorOutput,
  DetectorPick,
  PipelineResult,
  Signal,
  TimeOfDay,
  TriggerSource,
  WriterInput,
} from "./types.js";

const REGEN_FLOOR_MS = 30 * 60 * 1000;
const REGEN_DAILY_CEILING = 6;
const NEXTUP_HORIZON_MIN = 480; // 8 hours
const DETECTOR_MAX_TOKENS = 200;
const WRITER_MAX_TOKENS = 110;
const WRITER_HARD_SENTENCE_CAP = 2;

const DETECTOR_SCHEMA = {
  type: "object",
  properties: {
    empty: { type: "boolean" },
    picks: {
      type: "array",
      maxItems: 4,
      items: {
        type: "object",
        properties: {
          // Defensive bounds: the LLM could echo arbitrary text from
          // injected user content into these fields without these caps.
          signalId: { type: "string", maxLength: 200 },
          oneLiner: { type: "string", maxLength: 240 },
          why: { type: "string", maxLength: 160 },
        },
        required: ["signalId", "oneLiner", "why"],
        additionalProperties: false,
      },
    },
    reason: { type: ["string", "null"] },
  },
  required: ["empty", "picks", "reason"],
  additionalProperties: false,
} as const;

const BANNED_OPENER_REGEX =
  /^\s*(good\s+(morning|afternoon|evening)|heads\s+up|quick(\s+(note|update))?|just\b)/i;

// ─── Helpers ─────────────────────────────────────────────────────────────

export function timeOfDayFromHour(hour: number): TimeOfDay {
  if (hour >= 5 && hour < 11) return "morning";
  if (hour >= 11 && hour < 14) return "midday";
  if (hour >= 14 && hour < 18) return "afternoon";
  return "evening";
}

export function userLocalParts(
  timezone: string,
  now: Date,
): { hour: number; dayKey: string } {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const dayKey = `${get("year")}-${get("month")}-${get("day")}`;
  const hourStr = get("hour");
  // Intl can emit "24" in some locales for midnight — normalize.
  const hour = parseInt(hourStr, 10) % 24;
  return { hour, dayKey };
}

async function collectStream(
  provider: AIProvider,
  params: Parameters<AIProvider["chat"]>[0],
): Promise<string> {
  let text = "";
  for await (const chunk of provider.chat(params)) {
    if (chunk.type === "text") text += chunk.content;
  }
  return text;
}

function truncateToSentences(text: string, maxSentences: number): string {
  const trimmed = text.trim();
  if (!trimmed) return trimmed;
  // Naive but adequate for PA-style output. Splits on ., !, ? followed by
  // whitespace + capital letter or end of string. Numerics and "Mr." style
  // edge cases are unlikely in this surface; the eval rubric will catch
  // pathological output.
  const parts = trimmed.match(/[^.!?]+[.!?]+(?:\s|$)/g);
  if (!parts || parts.length <= maxSentences) return trimmed;
  return parts.slice(0, maxSentences).join("").trim();
}

function stripBannedOpener(text: string): string {
  // Drop leading openers like "Good morning, " or "Heads up — ". If the
  // entire first sentence is the opener, keep what's after it.
  return text.replace(BANNED_OPENER_REGEX, "").replace(/^[\s,—-]+/, "");
}

// ─── Stage 1: Detector ───────────────────────────────────────────────────

async function runDetector(
  provider: AIProvider,
  providerName: AIProviderName,
  input: DetectorInput,
): Promise<DetectorOutput> {
  const model = resolveModel(providerName, "small");
  try {
    const text = await collectStream(provider, {
      model,
      maxTokens: DETECTOR_MAX_TOKENS,
      system: getBriefingDetectorPrompt(),
      messages: [
        { role: "user", content: buildDetectorUserMessage(input) },
      ],
      responseFormat: {
        type: "json_schema",
        name: "briefing_detector_output",
        schema: DETECTOR_SCHEMA as unknown as Record<string, unknown>,
      },
      temperature: 0,
    });

    const parsed = JSON.parse(text.trim());
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof parsed.empty !== "boolean" ||
      !Array.isArray(parsed.picks)
    ) {
      throw new Error("detector output failed shape check");
    }
    return {
      empty: parsed.empty,
      picks: parsed.picks
        .filter(
          (p: unknown): p is DetectorPick =>
            typeof p === "object" &&
            p !== null &&
            typeof (p as DetectorPick).signalId === "string" &&
            typeof (p as DetectorPick).oneLiner === "string" &&
            typeof (p as DetectorPick).why === "string",
        )
        .slice(0, 4),
      reason: typeof parsed.reason === "string" ? parsed.reason : null,
    };
  } catch (err) {
    console.error("[briefing] detector failed:", err);
    return { empty: true, picks: [], reason: "detector_failed" };
  }
}

// ─── Stage 2: Writer ─────────────────────────────────────────────────────

async function runWriter(
  provider: AIProvider,
  providerName: AIProviderName,
  input: WriterInput,
): Promise<string | null> {
  const model = resolveModel(providerName, "medium");
  try {
    const text = await collectStream(provider, {
      model,
      maxTokens: WRITER_MAX_TOKENS,
      system: getBriefingWriterPrompt(),
      messages: [
        { role: "user", content: buildWriterUserMessage(input) },
      ],
      temperature: 0.4,
    });
    const cleaned = stripBannedOpener(text);
    const capped = truncateToSentences(cleaned, WRITER_HARD_SENTENCE_CAP);
    return capped.length > 0 ? capped : null;
  } catch (err) {
    console.error("[briefing] writer failed:", err);
    return null;
  }
}

// ─── Pipeline entry point ────────────────────────────────────────────────

export interface RunPipelineOptions {
  userId: string;
  provider: AIProvider;
  providerName: AIProviderName;
  triggerSource: TriggerSource;
  /** Skip the dirty/floor/ceiling gate. Used for explicit user-initiated
   *  refresh paths (currently unused; the POST /refresh route still
   *  respects the gates so we don't drift cost). */
  force?: boolean;
}

export async function runBriefingPipeline(
  opts: RunPipelineOptions,
): Promise<PipelineResult | null> {
  const now = new Date();
  const user = await prisma.user.findUnique({
    where: { id: opts.userId },
    select: { timezone: true },
  });
  if (!user) return null;
  const timezone = user.timezone;
  const { hour, dayKey } = userLocalParts(timezone, now);
  const timeOfDay = timeOfDayFromHour(hour);

  // ── Claim phase ──
  //
  // Concurrency rules:
  //   * Two refresh calls for the same user could arrive within ms of
  //     each other (multi-device, fast-tap, double-fire). Without a
  //     claim, both would pass the gate, both would call the LLM, the
  //     daily-regen counter would over-increment, and cost doubles.
  //   * We previously tried `pg_try_advisory_lock` (session-scoped) but
  //     Prisma's pooler can return DIFFERENT connections for the
  //     acquire and release calls, so the lock would silently leak.
  //
  // Fix: do gate-check + claim atomically in a SHORT tx. The advisory
  // lock here is `_xact_` (transaction-scoped) so it's bound to the
  // tx's connection and auto-released on commit. Inside the tx we set
  // `dirtyAt = null` — that is the visible claim. Any second worker
  // arriving while we run the LLM sees `dirtyAt = null` and bails.
  //
  // Failure handling: if the LLM call throws or the writer fails, the
  // empty-state template fires and we still upsert a row. We don't
  // need to restore `dirtyAt` because a brief WAS produced (even if
  // it's a template).
  const lockKey = stableLockKey("briefing:" + opts.userId);

  type ClaimResult =
    | { kind: "claimed"; lastBriefAt: Date | null; priorBriefSignalIds: string[]; counterToday: number }
    | { kind: "skip" };

  const claim: ClaimResult = await prisma.$transaction(async (tx) => {
    const lockRows = await tx.$queryRaw<Array<{ acquired: boolean }>>(
      Prisma.sql`SELECT pg_try_advisory_xact_lock(${lockKey}::bigint) AS acquired`,
    );
    if (!lockRows[0]?.acquired) {
      return { kind: "skip" } as const;
    }

    const current = await tx.userBriefing.findUnique({
      where: { userId: opts.userId },
    });

    // Reset day counter when the user-local day rolls over.
    const counterToday =
      current && current.regenDayKey === dayKey ? current.regenCountToday : 0;

    if (!opts.force && current) {
      if (!current.dirtyAt || current.dirtyAt <= current.generatedAt) {
        return { kind: "skip" } as const; // Not dirty.
      }
      if (now.getTime() - current.generatedAt.getTime() < REGEN_FLOOR_MS) {
        return { kind: "skip" } as const; // 30-min floor.
      }
      if (counterToday >= REGEN_DAILY_CEILING) {
        return { kind: "skip" } as const; // 6/day ceiling.
      }
    }

    // Claim: clear dirtyAt so any concurrent worker sees we're handling
    // it. Only updates an existing row — if no row yet, the final
    // upsert will create one (and there's no concurrent worker risk on
    // a row that doesn't exist).
    if (current) {
      await tx.userBriefing.update({
        where: { userId: opts.userId },
        data: { dirtyAt: null },
      });
    }

    return {
      kind: "claimed",
      lastBriefAt: current?.generatedAt ?? null,
      priorBriefSignalIds: current?.signalsUsedIds ?? [],
      counterToday,
    } as const;
  });

  if (claim.kind === "skip") return null;
  const { lastBriefAt, priorBriefSignalIds, counterToday } = claim;

  try {
    // ── Gather signals (parallel reads, no LLM yet) ──
    const [signals, nextUpVisible] = await Promise.all([
      collectAllSignals({
        userId: opts.userId,
        timezone,
        lastBriefAt,
        now,
      }),
      loadNextUpVisible(opts.userId, now),
    ]);

    // ── Stage 1: detector (LLM, no DB lock) ──
    const detectorInput: DetectorInput = {
      timeOfDay,
      nextUpVisible,
      lastBriefAt: lastBriefAt?.toISOString() ?? null,
      priorBriefSignalIds,
      signals,
    };
    const detectorOutput = await runDetector(
      opts.provider,
      opts.providerName,
      detectorInput,
    );

    let content: string;
    let isEmpty: boolean;
    let signalsUsedIds: string[];
    let triggerSource: TriggerSource = opts.triggerSource;

    if (detectorOutput.empty || detectorOutput.picks.length === 0) {
      content = pickEmptyTemplate(timeOfDay, hour);
      isEmpty = true;
      signalsUsedIds = [];
      if (
        detectorOutput.reason === "detector_failed" ||
        detectorOutput.reason === "detector_malformed"
      ) {
        triggerSource = "detector_failed";
      }
    } else {
      // ── Stage 2: writer (LLM, no DB lock) ──
      const writerInput: WriterInput = {
        timeOfDay,
        nextUpVisible,
        picks: detectorOutput.picks.map((p) => ({
          oneLiner: p.oneLiner,
          why: p.why,
        })),
      };
      const written = await runWriter(
        opts.provider,
        opts.providerName,
        writerInput,
      );
      if (written) {
        content = written;
        isEmpty = false;
        signalsUsedIds = detectorOutput.picks.map((p) => p.signalId);
      } else {
        content = pickEmptyTemplate(timeOfDay, hour);
        isEmpty = true;
        signalsUsedIds = [];
        triggerSource = "writer_failed";
      }
    }

    // ── Persist in a short transaction (no LLM inside) ──
    await prisma.userBriefing.upsert({
      where: { userId: opts.userId },
      create: {
        userId: opts.userId,
        content,
        isEmpty,
        signalsUsedIds,
        generatedAt: now,
        dirtyAt: null,
        regenCountToday: 1,
        regenDayKey: dayKey,
        lastTriggerSource: triggerSource,
      },
      update: {
        content,
        isEmpty,
        signalsUsedIds,
        generatedAt: now,
        dirtyAt: null,
        regenCountToday: counterToday + 1,
        regenDayKey: dayKey,
        lastTriggerSource: triggerSource,
      },
    });

    // Notify all of this user's connected clients (desktop, multiple iOS
    // devices) so they refetch /briefing/current immediately. This is
    // how we keep multi-device consistency without putting UserBriefing
    // into SYNC_TABLES — the row's shape (no separate id, no deletedAt)
    // isn't sync-pull-compatible, and on-demand refetch on a tiny push
    // signal is the established pattern for single-row resources.
    publishSSE(opts.userId, {
      type: "briefing.updated",
      payload: { generatedAt: now.toISOString(), isEmpty },
    });

    return { content, isEmpty, signalsUsedIds };
  } catch (err) {
    // If the pipeline body throws AFTER the claim tx committed,
    // `dirtyAt` is null but no brief was written. The next trigger
    // will set dirtyAt again so the system recovers — we just log so
    // the failure isn't silent.
    console.error("[briefing] pipeline body threw after claim:", err);
    throw err;
  }
}

// Postgres advisory locks take a bigint key. Derive a stable signed 64-bit
// int from the userId so the same user always maps to the same lock slot,
// and different users never collide. Uses node's built-in hash (a 32-bit
// FNV-1a equivalent in a deterministic shape).
function stableLockKey(name: string): bigint {
  // FNV-1a 64-bit. Plenty of distribution for per-user keys.
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (let i = 0; i < name.length; i++) {
    hash ^= BigInt(name.charCodeAt(i));
    hash = (hash * prime) & 0xffffffffffffffffn;
  }
  // Postgres bigint is signed; flip the high bit interpretation.
  if (hash >= 0x8000000000000000n) hash -= 0x10000000000000000n;
  return hash;
}

async function loadNextUpVisible(
  userId: string,
  now: Date,
): Promise<DetectorInput["nextUpVisible"]> {
  const horizon = new Date(now.getTime() + NEXTUP_HORIZON_MIN * 60 * 1000);

  // Filter by visible calendars so hidden-calendar events don't get
  // suppressed as "user already sees this" — they don't, the NextUp
  // card honors the same visibility filter the collectors use.
  const visibleCalendars = await prisma.calendarList.findMany({
    where: { googleAccount: { userId }, isVisible: true },
    select: { id: true },
  });
  const calendarIds = visibleCalendars.map((c) => c.id);
  if (calendarIds.length === 0) return null;

  const next = await prisma.calendarEvent.findFirst({
    where: {
      userId,
      calendarListId: { in: calendarIds },
      startTime: { gt: now, lt: horizon },
      status: "confirmed",
      myResponseStatus: { not: "observer" },
    },
    orderBy: { startTime: "asc" },
    select: { title: true, startTime: true },
  });
  if (!next) return null;
  const startsInMin = Math.max(
    0,
    Math.round((next.startTime.getTime() - now.getTime()) / 60000),
  );
  return { title: next.title, startsInMin };
}
