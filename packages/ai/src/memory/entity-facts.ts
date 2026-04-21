import type { AIProvider } from "../providers/types.js";
import type { AIProviderName } from "@brett/types";
import type { ExtendedPrismaClient } from "@brett/api-core";
import { resolveModel } from "../router.js";
import { logUsage } from "./usage.js";
import { validateFacts, parseLLMFactResponse } from "./validation.js";
import { SECURITY_BLOCK } from "../context/system-prompts.js";

export function getEntityFactExtractionPrompt(entityLabel: string): string {
  return `${SECURITY_BLOCK}

Extract durable facts about the USER from this ${entityLabel}.

## Default is EMPTY — be extremely restrained
Most ${entityLabel}s do NOT contain durable user facts. The default output is [].
When uncertain, return []. Prefer missing a fact over inventing one.

## Extract ONLY when the ${entityLabel} explicitly states:
- A PREFERENCE the user voiced in the first person ("I prefer X", "I don't like Y")
- A persistent CONTEXT fact the user stated about themselves ("I'm the CEO", "I'm based in Pacific")
- A RELATIONSHIP the user identified in first person OR via a possessive ("Jordan is my manager", "my manager Jordan", "Priya reports to me", "my direct report Priya")
- A HABIT the user described as recurring for themselves ("I review PRs every morning")

## NEVER extract — hard rules
- Do NOT infer anything. If the ${entityLabel} doesn't contain a first-person statement about the user, return [].
- Do NOT treat task or meeting subject-matter as evidence of user preferences or context. Example: a task "Review Q3 budget — Sarah mentioned 15% cut needed" is NOT evidence that the user has "budget oversight" or "works with Sarah on budget" — it's just a task.
- Do NOT extract facts about OTHER people from content that happens to name them (e.g., "Buy birthday cake for Sam" is NOT evidence the user "knows Sam" — it's a shopping task).
- Do NOT extract transient states (currently busy, promotion pending, running late today).
- Do NOT extract the content of the ${entityLabel} itself (task titles, article topics, meeting subjects).
- Do NOT extract one-time actions or deadlines.

## The "would this still be true next month?" test
Before adding a fact, ask: if I read this fact 30 days from now, would it still be accurate and useful?
- "User is CEO" → yes, keep.
- "User prefers Linear over Jira" → yes, keep.
- "User is preparing Q3 budget" → no, transient work, drop.
- "User is being considered for Director" → no, transient, drop.
- "User works with Sarah on budget stuff" → only if EXPLICITLY stated as an ongoing relationship in the text; skip if inferred.

## Output
Return a JSON array. No markdown fences. No commentary.
Each element: {"category": "preference"|"context"|"relationship"|"habit", "key": "snake_case_identifier", "value": "Human-readable description, max 200 chars"}

If no durable user facts are explicitly stated — and most ${entityLabel}s don't have any — return [].`;
}

/**
 * Extracts persistent user facts from non-conversation entities (tasks, meeting notes, etc.).
 * Runs fire-and-forget after embedding completes.
 */
export async function extractEntityFacts(
  entityType: string,
  entityId: string,
  userId: string,
  assembledText: string,
  provider: AIProvider,
  providerName: AIProviderName,
  prisma: ExtendedPrismaClient,
): Promise<void> {
  // Skip trivial content — not enough signal for fact extraction
  if (assembledText.length < 100) return;

  const model = resolveModel(providerName, "small");

  const entityLabel = entityType.replace("_", " ");
  const systemPrompt = getEntityFactExtractionPrompt(entityLabel);

  const userMessage = `<user_data label="entity_content">\n${assembledText.slice(0, 4000)}\n</user_data>`;

  let fullResponse = "";
  for await (const chunk of provider.chat({
    model,
    messages: [{ role: "user", content: userMessage }],
    system: systemPrompt,
    temperature: 0.1,
    maxTokens: 512,
  })) {
    if (chunk.type === "text") fullResponse += chunk.content;
    if (chunk.type === "done") {
      logUsage(prisma, {
        userId,
        provider: providerName,
        model,
        modelTier: "small",
        source: "entity_fact_extraction",
        inputTokens: chunk.usage.input,
        outputTokens: chunk.usage.output,
      }).catch(() => {});
    }
  }

  const parsed = parseLLMFactResponse(fullResponse);
  if (!parsed) return;
  const facts = validateFacts(parsed);

  let failedCount = 0;
  for (const fact of facts) {
    try {
      await prisma.$transaction(async (tx: any) => {
        const existing = await tx.userFact.findFirst({
          where: { userId, key: fact.key, validUntil: null },
        });

        if (existing) {
          if (existing.value === fact.value) return; // No change
          // Value changed — supersede the old fact
          const newFact = await tx.userFact.create({
            data: {
              userId,
              category: fact.category,
              key: fact.key,
              value: fact.value,
              sourceType: entityType,
              sourceEntityId: entityId,
              validFrom: new Date(),
            },
          });
          await tx.userFact.update({
            where: { id: existing.id },
            data: { validUntil: new Date(), supersededBy: newFact.id },
          });
        } else {
          await tx.userFact.create({
            data: {
              userId,
              category: fact.category,
              key: fact.key,
              value: fact.value,
              sourceType: entityType,
              sourceEntityId: entityId,
              validFrom: new Date(),
            },
          });
        }
      });
    } catch (err) {
      // One-at-a-time — one bad fact should not kill the batch. Count +
      // log enough context to debug without PII (the fact value itself
      // may contain user data).
      failedCount++;
      console.error(
        `[entity-facts] upsert failed for user=${userId} entity=${entityType}:${entityId} key=${fact.key}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
  if (failedCount > 0) {
    console.warn(
      `[entity-facts] ${failedCount}/${facts.length} facts failed to upsert for user=${userId} entity=${entityType}:${entityId}`,
    );
  }
}
