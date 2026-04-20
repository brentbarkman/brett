import { describe, it, expect } from "vitest";
import { getSystemPrompt } from "../system-prompts.js";

// These assertions guard the "search before refusing" guidance that keeps
// the chat assistant from refusing factual questions about the user's world
// without first trying retrieval. Seen in prod on 2026-04-20: user asked
// "what is Function Health's strike price?" — the info was in a Granola
// meeting note that day, but Brett refused ("I don't have access to
// real-time financial data…") without calling any tool. After telling
// Brett where to look, retrieval worked fine.
//
// A full behavioral eval with real LLM calls lives outside this repo
// (@brett/evals is a TODO). For now, the cheapest protection is to
// assert the load-bearing phrases survive edits to the prompt.

describe("getSystemPrompt", () => {
  const prompt = getSystemPrompt("Brett");

  it("instructs the assistant to search before refusing factual questions", () => {
    expect(prompt).toMatch(/SEARCH BEFORE REFUSING/);
    expect(prompt).toMatch(/search_things/);
  });

  it("does not tell the assistant to decline domain-adjacent questions outright", () => {
    // The old prompt said 'Stay in domain (tasks/calendar/content).
    // Decline other requests.' which caused blanket refusals for anything
    // that sounded finance-y or off-topic, even when the answer was in
    // the user's own notes.
    expect(prompt).not.toMatch(/Decline other requests\.?$/m);
  });

  it("keeps meeting-notes retrieval in domain", () => {
    expect(prompt).toMatch(/meeting notes|get_meeting_notes/);
  });

  // Haiku grabbed the phrase "real-time data the user hasn't discussed" as
  // justification for refusing "what is Function Health's strike price?" in
  // prod on 2026-04-20. That escape hatch can't be evaluated without first
  // retrieving — which is exactly the step SEARCH BEFORE REFUSING requires.
  // Don't reintroduce any variant of it.
  it("does not list 'real-time data' as a decline category", () => {
    expect(prompt).not.toMatch(/real-time data/i);
    expect(prompt).not.toMatch(/real time data/i);
  });

  // The rule should be imperative, not conditional. "When a request is a
  // factual question AND no other tool obviously matches" lets the model
  // decide either premise is false and skip retrieval.
  it("frames SEARCH BEFORE REFUSING as mandatory, not conditional", () => {
    expect(prompt).toMatch(/factual question/i);
    // Drop the softer conditional framing that lets the model opt out by
    // deciding "no other tool obviously matches" is false.
    expect(prompt).not.toMatch(/no other tool obviously matches/i);
    // Must contain a strong imperative — "never", "must", or "always".
    expect(prompt).toMatch(/never (say|refuse|decline|answer)|must (call|search|retrieve|trigger)|always (call|search|retrieve)/i);
  });

  // Finance/health/legal/personal — the topic doesn't matter. Retrieval
  // decides. Haiku was refusing on topic alone; the prompt should tell it
  // not to.
  it("explicitly covers finance/health/legal topics in the retrieval rule", () => {
    expect(prompt).toMatch(/finance|financial|health|legal/i);
  });
});
