import { AI_CONFIG } from "../config.js";

/**
 * Rough token estimate: ~4 characters per token.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Splits text into overlapping chunks suitable for embedding.
 *
 * Strategy:
 * 1. Split on paragraph boundaries (\n\n) first.
 * 2. If a paragraph exceeds maxChunkTokens, split further on sentence boundaries.
 * 3. Accumulate segments into chunks until approaching maxChunkTokens.
 * 4. Prepend overlap from the tail of the previous chunk.
 * 5. Cap each chunk at maxTextLength characters.
 */
export function chunkText(text: string): string[] {
  if (!text) return [];

  const { maxChunkTokens, chunkOverlapTokens, maxTextLength } =
    AI_CONFIG.embedding;

  // Step 1: split into segments (paragraph → sentence fallback)
  const segments = splitIntoSegments(text, maxChunkTokens);

  // Step 2: accumulate segments into chunks with overlap
  const chunks: string[] = [];
  let current: string[] = [];
  let currentTokens = 0;

  for (const segment of segments) {
    const segTokens = estimateTokens(segment);

    if (currentTokens + segTokens > maxChunkTokens && current.length > 0) {
      // Emit current chunk
      const chunkText = buildChunk(current, maxTextLength);
      chunks.push(chunkText);

      // Build overlap: take chars from the tail of the emitted chunk
      const overlapChars = chunkOverlapTokens * 4;
      const overlapText = chunkText.slice(-overlapChars).trimStart();

      // Start next chunk with overlap + current segment
      current = overlapText ? [overlapText, segment] : [segment];
      currentTokens = estimateTokens(current.join(" "));
    } else {
      current.push(segment);
      currentTokens += segTokens;
    }
  }

  // Emit any remaining content
  if (current.length > 0) {
    chunks.push(buildChunk(current, maxTextLength));
  }

  return chunks;
}

/**
 * Joins accumulated segments and caps at maxTextLength.
 */
function buildChunk(segments: string[], maxTextLength: number): string {
  return segments.join(" ").slice(0, maxTextLength);
}

/**
 * Splits text first by paragraphs, then by sentences if a paragraph is too large.
 */
function splitIntoSegments(text: string, maxChunkTokens: number): string[] {
  const paragraphs = text.split(/\n\n+/);
  const segments: string[] = [];

  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (!trimmed) continue;

    if (estimateTokens(trimmed) <= maxChunkTokens) {
      segments.push(trimmed);
    } else {
      // Split on sentence boundaries
      const sentences = splitOnSentences(trimmed);
      segments.push(...sentences);
    }
  }

  return segments;
}

/**
 * Splits a large block of text on sentence boundaries (`. ` pattern).
 * Falls back to hard character splits if no sentence boundaries exist.
 */
function splitOnSentences(text: string): string[] {
  const { maxChunkTokens } = AI_CONFIG.embedding;
  const maxChunkChars = maxChunkTokens * 4;

  // Split on ". " keeping the period attached to the preceding sentence
  const raw = text.split(/(?<=\. )(?=[A-Z])/);
  const sentences = raw.map((s) => s.trim()).filter(Boolean);

  // If splitting on sentences didn't help (e.g. no sentence boundaries),
  // fall back to hard splits on maxChunkChars boundaries.
  if (sentences.length === 1 && sentences[0].length > maxChunkChars) {
    const segments: string[] = [];
    let remaining = sentences[0];
    while (remaining.length > maxChunkChars) {
      segments.push(remaining.slice(0, maxChunkChars));
      remaining = remaining.slice(maxChunkChars);
    }
    if (remaining) segments.push(remaining);
    return segments;
  }

  return sentences;
}
