// User-message construction for the briefing detector + writer.
// Lives in its own module so the eval harness builds messages the same
// way production does — without this, the eval would test a different
// surface than what ships, and any prompt-injection regression would
// pass the eval while failing in production.
//
// The wrapping rule (load-bearing):
//   * Trusted, system-controlled fields (timeOfDay, lastBriefAt,
//     priorBriefSignalIds) are interpolated as plain JSON outside any
//     `<user_data>` block.
//   * EVERY field that contains user-controlled OR third-party content
//     (signal payloads, event titles, newsletter subject/summary, RAG'd
//     meeting-note snippets, NextUp.title) is wrapped in
//     `<user_data label="…">` via `wrapUserData()`, which also escapes
//     `</user_data>` tag-breakout attempts.
//
// See docs/superpowers/specs/2026-05-16-briefing-pipeline-v2-design.md.

import { wrapUserData } from "@brett/ai";
import type { DetectorInput, WriterInput } from "./types.js";

export function buildDetectorUserMessage(input: DetectorInput): string {
  // Trusted control fields — these come from server-side computation and
  // are never user-controlled. Safe to embed directly.
  const control = JSON.stringify({
    timeOfDay: input.timeOfDay,
    lastBriefAt: input.lastBriefAt,
    priorBriefSignalIds: input.priorBriefSignalIds,
  });

  // Untrusted: signals (titles, subjects, summaries, notes) +
  // nextUpVisible.title (calendar event title — also user-controlled in
  // the sense that meeting organizers can put anything there).
  const untrustedNextUp = input.nextUpVisible
    ? JSON.stringify({
        title: input.nextUpVisible.title,
        startsInMin: input.nextUpVisible.startsInMin,
      })
    : "null";

  const untrustedSignals = JSON.stringify(input.signals);

  return [
    `Trusted control:\n${control}`,
    `\nNextUp the user can already see (inside the next 8h):\n${wrapUserData("next_up", untrustedNextUp)}`,
    `\nCandidate signals to judge:\n${wrapUserData("signals", untrustedSignals)}`,
  ].join("\n");
}

export function buildWriterUserMessage(input: WriterInput): string {
  const control = JSON.stringify({ timeOfDay: input.timeOfDay });

  // The picks were authored by the detector but reflect upstream user
  // content (event titles, RAG'd note snippets). Treat the whole picks
  // payload as untrusted — the writer should treat it as DATA, not as
  // instructions, even if the detector's own output got influenced.
  const untrustedNextUp = input.nextUpVisible
    ? JSON.stringify({
        title: input.nextUpVisible.title,
        startsInMin: input.nextUpVisible.startsInMin,
      })
    : "null";

  const untrustedPicks = JSON.stringify(input.picks);

  return [
    `Trusted control:\n${control}`,
    `\nNextUp the user can already see:\n${wrapUserData("next_up", untrustedNextUp)}`,
    `\nPre-filtered signals to write about:\n${wrapUserData("picks", untrustedPicks)}`,
  ].join("\n");
}
