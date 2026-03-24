/**
 * LLM-as-judge module for qualitative eval.
 *
 * Evaluates AI output against a set of criteria using a second LLM call.
 * Currently a placeholder — full implementation deferred until we have
 * enough qualitative eval fixtures to justify the cost.
 */

import type { AIProvider } from "@brett/ai";

export async function judgeQuality(
  output: string,
  criteria: string[],
  provider: AIProvider,
  model: string
): Promise<{ passed: boolean; scores: Record<string, boolean> }> {
  // TODO: Implement LLM-as-judge
  // Approach:
  //   1. Build a scoring prompt: "Given this output: <output>\nScore each criterion: <criteria>"
  //   2. Call provider.chat() with a structured output tool (e.g. score_criteria)
  //   3. Parse the tool args to extract per-criterion boolean scores
  //   4. passed = all(scores.values())

  void output;
  void criteria;
  void provider;
  void model;

  return { passed: true, scores: {} };
}
