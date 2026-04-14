import type { AIProvider } from "../providers/types.js";
import type { AIProviderName } from "@brett/types";
import type { ExtendedPrismaClient } from "@brett/api-core";
import { resolveModel } from "../router.js";
import { getFactExtractionPrompt } from "../context/system-prompts.js";
import { AI_CONFIG } from "../config.js";
import { logUsage } from "./usage.js";

const VALID_CATEGORIES = new Set(["preference", "context", "relationship", "habit"]);

const INJECTION_PATTERN =
  /\b(ignore|override|system prompt|instruction|you are now|always execute|never ask|secret|api.?key|password|disregard|bypass|credentials|token)\b/i;

// Patterns that could break out of user_data tags or inject XML-like structures
const TAG_INJECTION_PATTERN = /<\/?user_data|<\/?system|<\/?instruction/i;

interface ExtractedFact {
  category: string;
  key: string;
  value: string;
}

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
  const conversationText = contextPrefix + relevant
    .map((m) => `${m.role}: ${m.content}`)
    .join("\n\n");

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
  let facts: ExtractedFact[];
  try {
    // Handle potential markdown code blocks
    const cleaned = fullResponse
      .trim()
      .replace(/^```json?\s*\n?/i, "")
      .replace(/\n?```\s*$/, "");
    facts = JSON.parse(cleaned);
  } catch (parseErr) {
    console.warn("[fact-extraction] Failed to parse LLM response:", fullResponse.slice(0, 200));
    return;
  }

  if (!Array.isArray(facts)) return;

  // 6. Validate and upsert each fact
  for (const fact of facts) {
    if (!fact || typeof fact !== "object") continue;
    if (typeof fact.category !== "string" || typeof fact.key !== "string" || typeof fact.value !== "string") continue;

    // Category must be valid
    if (!VALID_CATEGORIES.has(fact.category)) continue;

    // Max value length
    if (fact.value.length > AI_CONFIG.memory.maxFactValueLength) continue;

    // No instruction-like content
    if (INJECTION_PATTERN.test(fact.value)) continue;
    if (INJECTION_PATTERN.test(fact.key)) continue;

    // No XML/tag injection (could break out of <user_data> blocks when facts are injected into prompts)
    if (TAG_INJECTION_PATTERN.test(fact.value)) continue;

    // Key must be snake_case and reasonable length
    if (!/^[a-z][a-z0-9_]{1,63}$/.test(fact.key)) continue;

    // 7. Temporal upsert: find active fact, supersede if value changed, or create new
    // Wrapped in a transaction to prevent race conditions on concurrent extractions
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
    } catch {
      // Silent fail on individual fact errors
    }
  }
}
