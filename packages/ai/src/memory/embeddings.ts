import { OpenAIEmbeddingProvider } from "../providers/embedding.js";
import type { PrismaClient } from "@prisma/client";
import { AI_CONFIG } from "../config.js";

export async function embedConversation(
  sessionId: string,
  userId: string,
  openaiApiKey: string | null,
  prisma: PrismaClient,
): Promise<void> {
  if (!openaiApiKey) return;

  // 1. Create embedding provider
  const embeddingProvider = new OpenAIEmbeddingProvider(openaiApiKey);

  // 2. Load conversation messages
  const messages = await prisma.conversationMessage.findMany({
    where: { sessionId },
    orderBy: { createdAt: "asc" },
    select: { role: true, content: true },
  });

  const relevant = messages.filter(
    (m) => m.role === "user" || m.role === "assistant",
  );

  if (relevant.length < 2) return;

  // 3. Combine into single text
  const text = relevant
    .map((m) => `${m.role}: ${m.content}`)
    .join("\n\n");

  // Limit text length to avoid excessive embedding costs
  const truncated = text.slice(0, AI_CONFIG.memory.maxEmbeddingTextLength);

  // 4. Generate embedding vector
  const vector = await embeddingProvider.embed(truncated);

  // 5. Validate vector
  if (!Array.isArray(vector) || vector.length !== AI_CONFIG.memory.embeddingDimensions) return;
  if (!vector.every((n) => typeof n === "number" && Number.isFinite(n))) return;

  // 6. Insert via raw SQL (Prisma doesn't support vector type)
  const vectorStr = `[${vector.join(",")}]`;
  await prisma.$executeRaw`
    INSERT INTO "ConversationEmbedding" (id, "userId", "sessionId", "chunkText", embedding, "createdAt")
    VALUES (gen_random_uuid(), ${userId}, ${sessionId}, ${truncated}, ${vectorStr}::vector, NOW())
  `;
}

export async function searchSimilar(
  userId: string,
  query: string,
  openaiApiKey: string,
  prisma: PrismaClient,
  limit: number = 5,
): Promise<Array<{ chunkText: string; similarity: number }>> {
  const embeddingProvider = new OpenAIEmbeddingProvider(openaiApiKey);

  // 1. Embed query
  const queryVector = await embeddingProvider.embed(query);

  if (!Array.isArray(queryVector) || queryVector.length !== AI_CONFIG.memory.embeddingDimensions) return [];

  const vectorStr = `[${queryVector.join(",")}]`;

  // 2. Search via cosine similarity
  const results = await prisma.$queryRaw<
    Array<{ chunkText: string; similarity: number }>
  >`
    SELECT "chunkText", 1 - (embedding <=> ${vectorStr}::vector) as similarity
    FROM "ConversationEmbedding"
    WHERE "userId" = ${userId}
    ORDER BY embedding <=> ${vectorStr}::vector
    LIMIT ${limit}
  `;

  return results;
}
