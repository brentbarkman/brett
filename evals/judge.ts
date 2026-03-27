/**
 * LLM-as-judge module for qualitative eval.
 *
 * Evaluates AI output against a set of criteria using a second LLM call.
 * The judge LLM scores each criterion as pass/fail with reasoning.
 */

import type { AIProvider } from "@brett/ai";

interface JudgeResult {
  passed: boolean;
  scores: Record<string, boolean>;
  reasoning: Record<string, string>;
}

export async function judgeQuality(
  output: string,
  criteria: string[],
  provider: AIProvider,
  model: string
): Promise<JudgeResult> {
  const criteriaList = criteria
    .map((c, i) => `${i + 1}. ${c}`)
    .join("\n");

  const prompt = `You are an eval judge. Score each criterion as PASS or FAIL for the given output.

<output>
${output}
</output>

<criteria>
${criteriaList}
</criteria>

For each criterion, respond with exactly one line in this format:
CRITERION_NUMBER: PASS|FAIL — brief reason

Example:
1: PASS — output contains 4 bullet points
2: FAIL — mentions a task "quarterly review" not present in input data`;

  const chunks: Array<{ type: string; content?: string }> = [];
  for await (const chunk of provider.chat({
    model,
    messages: [{ role: "user", content: prompt }],
    system:
      "You are a strict eval judge. Score each criterion independently. " +
      "Be precise — if the criterion says 'under 120 words', count the words.",
    maxTokens: 1024,
    temperature: 0,
  })) {
    chunks.push(chunk);
  }

  const text = chunks
    .filter((c) => c.type === "text")
    .map((c) => c.content ?? "")
    .join("");

  const scores: Record<string, boolean> = {};
  const reasoning: Record<string, string> = {};

  for (let i = 0; i < criteria.length; i++) {
    const lineMatch = text.match(
      new RegExp(`${i + 1}:\\s*(PASS|FAIL)\\s*[—-]\\s*(.*)`, "i")
    );
    if (lineMatch) {
      scores[criteria[i]] = lineMatch[1].toUpperCase() === "PASS";
      reasoning[criteria[i]] = lineMatch[2].trim();
    } else {
      scores[criteria[i]] = false;
      reasoning[criteria[i]] = "Judge did not score this criterion";
    }
  }

  return {
    passed: Object.values(scores).every(Boolean),
    scores,
    reasoning,
  };
}
