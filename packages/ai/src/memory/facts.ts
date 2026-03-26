import type { AIProvider } from "../providers/types.js";
import type { AIProviderName } from "@brett/types";
import type { PrismaClient } from "@prisma/client";
import { resolveModel } from "../router.js";
import { FACT_EXTRACTION_PROMPT } from "../context/system-prompts.js";
import { AI_CONFIG } from "../config.js";

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
  prisma: PrismaClient,
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
  const MIN_USER_TEXT_LENGTH = 100; // ~25 words minimum
  if (userText.length < MIN_USER_TEXT_LENGTH) return;

  const conversationText = relevant
    .map((m) => `${m.role}: ${m.content}`)
    .join("\n\n");

  // 4. Call LLM (small model) with FACT_EXTRACTION_PROMPT
  const model = resolveModel(providerName, "small");
  let fullResponse = "";

  for await (const chunk of provider.chat({
    model,
    messages: [{ role: "user", content: conversationText }],
    system: FACT_EXTRACTION_PROMPT,
    temperature: 0.1,
    maxTokens: 1024,
  })) {
    if (chunk.type === "text") {
      fullResponse += chunk.content;
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

    // 7. Upsert into UserFact
    try {
      await prisma.userFact.upsert({
        where: { userId_key: { userId, key: fact.key } },
        create: {
          userId,
          category: fact.category,
          key: fact.key,
          value: fact.value,
        },
        update: {
          category: fact.category,
          value: fact.value,
        },
      });
    } catch {
      // Silent fail on individual upsert errors
    }
  }
}
