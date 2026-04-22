import type { AIProvider } from "../providers/types.js";
import type { AIProviderName } from "@brett/types";
import type { ExtendedPrismaClient } from "@brett/api-core";
import { resolveModel } from "../router.js";
import { getFactExtractionPrompt } from "../context/system-prompts.js";
import { wrapUserData } from "../context/assembler.js";
import { logUsage } from "./usage.js";
import { validateFacts, parseLLMFactResponse } from "./validation.js";

export async function extractFacts(
  sessionId: string,
  userId: string,
  provider: AIProvider,
  providerName: AIProviderName,
  prisma: ExtendedPrismaClient,
  /** Optional context about the item being discussed (helps extract domain-specific facts) */
  itemContext?: string,
  assistantName?: string,
): Promise<void> {
  // 1. Load conversation messages for this session
  const messages = await prisma.conversationMessage.findMany({
    where: { sessionId },
    orderBy: { createdAt: "asc" },
    select: { role: true, content: true },
  });

  // 2. Filter to user + assistant messages
  const relevant = messages.filter(
    (m) => m.role === "user" || m.role === "assistant",
  );

  // 3. Skip trivial conversations — not worth the LLM call
  if (relevant.length < 2) return;

  // Only extract facts if the user's messages have enough substance.
  // Simple commands ("what's on my plate today", "create task buy groceries")
  // rarely contain personal facts worth remembering.
  const userText = relevant
    .filter((m) => m.role === "user")
    .map((m) => m.content)
    .join(" ");
  const MIN_USER_TEXT_LENGTH = 300; // ~75 words — skip simple Q&A, only extract from substantial conversations
  if (userText.length < MIN_USER_TEXT_LENGTH) return;

  const contextPrefix = itemContext ? `[Context: ${itemContext}]\n\n` : "";
  const rawConversation = contextPrefix + relevant
    .map((m) => `${m.role}: ${m.content}`)
    .join("\n\n");
  // Wrap in <user_data> tags and escape any closing tags so a crafted
  // user message can't break out and inject instructions into the trusted
  // prompt space.
  const conversationText = wrapUserData("conversation", rawConversation);

  // 4. Call LLM (small model) with FACT_EXTRACTION_PROMPT
  const model = resolveModel(providerName, "small");
  let fullResponse = "";

  for await (const chunk of provider.chat({
    model,
    messages: [{ role: "user", content: conversationText }],
    system: getFactExtractionPrompt(assistantName ?? "Brett"),
    temperature: 0.1,
    maxTokens: 1024,
  })) {
    if (chunk.type === "text") {
      fullResponse += chunk.content;
    }
    if (chunk.type === "done") {
      logUsage(prisma, {
        userId,
        sessionId,
        provider: providerName,
        model,
        modelTier: "small",
        source: "fact_extraction",
        inputTokens: chunk.usage.input,
        outputTokens: chunk.usage.output,
      }).catch(() => {});
    }
  }

  // 5. Parse JSON response
  const parsed = parseLLMFactResponse(fullResponse);
  if (!parsed) {
    console.warn("[fact-extraction] Failed to parse LLM response:", fullResponse.slice(0, 200));
    return;
  }

  const facts = validateFacts(parsed);

  // 6. Upsert each validated fact
  let failures = 0;
  for (const fact of facts) {
    // 7. Temporal upsert — wrapped in a transaction to prevent race conditions on concurrent extractions
    try {
      await prisma.$transaction(async (tx: any) => {
        const existing = await tx.userFact.findFirst({
          where: { userId, key: fact.key, validUntil: null },
        });

        if (existing && existing.value === fact.value) {
          // Same value — skip (no contradiction)
          return;
        } else if (existing) {
          // Value changed — supersede the old fact and create a new one
          const newFact = await tx.userFact.create({
            data: {
              userId,
              category: fact.category,
              key: fact.key,
              value: fact.value,
              sourceSessionId: sessionId,
              sourceType: "conversation",
              sourceEntityId: sessionId,
            },
          });
          await tx.userFact.update({
            where: { id: existing.id },
            data: { validUntil: new Date(), supersededBy: newFact.id },
          });
        } else {
          // No existing active fact — create new
          await tx.userFact.create({
            data: {
              userId,
              category: fact.category,
              key: fact.key,
              value: fact.value,
              sourceSessionId: sessionId,
              sourceType: "conversation",
              sourceEntityId: sessionId,
            },
          });
        }
      });
    } catch (err) {
      // Don't let a single fact take down the whole extraction batch, but do
      // emit — silent swallowing hid a constraint violation for weeks.
      failures++;
      console.error("[fact-extraction] upsert failed", {
        userId,
        sessionId,
        key: fact.key,
        category: fact.category,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }
  if (failures > 0) {
    console.warn(
      `[fact-extraction] ${failures}/${facts.length} facts failed to upsert for user ${userId}`,
    );
  }
}
