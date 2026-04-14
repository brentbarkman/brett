import type { AIProvider } from "../providers/types.js";
import type { AIProviderName } from "@brett/types";
import type { ExtendedPrismaClient } from "@brett/api-core";
import { resolveModel } from "../router.js";
import { logUsage } from "./usage.js";
import { validateFacts, parseLLMFactResponse } from "./validation.js";
import { SECURITY_BLOCK } from "../context/system-prompts.js";

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
  const systemPrompt = `${SECURITY_BLOCK}

Extract facts about the user from this ${entityLabel}. Only extract persistent facts about the user's preferences, relationships, habits, or context — NOT the task/event content itself.

Return a JSON array. No markdown code fences, no commentary.
Each element: {"category": "preference"|"context"|"relationship"|"habit", "key": "snake_case_identifier", "value": "Human-readable description, max 200 chars"}

If no user facts are present, return [].`;

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
    } catch {
      // Silent fail on individual fact errors — don't break the pipeline
    }
  }
}
