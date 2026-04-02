import { chunkText } from "./chunker.js";
import { AI_CONFIG } from "../config.js";

// --- Input types (inline, fields only needed for assembly) ---

export interface ItemAssemblerInput {
  title: string;
  description: string | null | undefined;
  notes: string | null | undefined;
}

export interface ContentAssemblerInput {
  type: string;
  title: string;
  contentTitle: string | null | undefined;
  contentDescription: string | null | undefined;
  contentBody: string | null | undefined;
}

export interface EventAssemblerInput {
  title: string;
  description: string | null | undefined;
  location: string | null | undefined;
}

export interface TranscriptEntry {
  speaker: string;
  text: string;
}

export interface MeetingNoteAssemblerInput {
  title: string;
  summary: string | null | undefined;
  transcript: TranscriptEntry[] | null | undefined;
}

export interface FindingAssemblerInput {
  title: string;
  description: string | null | undefined;
  reasoning: string | null | undefined;
}

export interface ConversationMessage {
  role: string;
  content: string;
}

// --- Helpers ---

function present(value: string | null | undefined): value is string {
  return typeof value === "string" && value.length > 0;
}

// --- Assemblers ---

/**
 * Assembles embeddable text for a task/item.
 * Format: `[Task] {title}\n{description}\n{notes}`, omitting null/empty fields.
 */
export function assembleItemText(item: ItemAssemblerInput): string[] {
  const parts: string[] = [`[Task] ${item.title}`];
  if (present(item.description)) parts.push(item.description);
  if (present(item.notes)) parts.push(item.notes);
  return [parts.join("\n")];
}

/**
 * Assembles embeddable text for a content item.
 * Chunk 0: `[Content: {type}] title — contentTitle — contentDescription`
 * Chunks 1+: contentBody chunked via chunkText()
 */
export function assembleContentText(item: ContentAssemblerInput): string[] {
  const headerParts: string[] = [`[Content: ${item.type}] ${item.title}`];
  if (present(item.contentTitle)) headerParts.push(item.contentTitle);
  if (present(item.contentDescription)) headerParts.push(item.contentDescription);
  const header = headerParts.join(" — ");

  if (!present(item.contentBody)) {
    return [header];
  }

  const bodyChunks = chunkText(item.contentBody);
  return [header, ...bodyChunks];
}

/**
 * Assembles embeddable text for a calendar event.
 * Format: `[Meeting] {title}\n{description}\nLocation: {location}`, omitting null/empty fields.
 */
export function assembleEventText(event: EventAssemblerInput): string[] {
  const parts: string[] = [`[Meeting] ${event.title}`];
  if (present(event.description)) parts.push(event.description);
  if (present(event.location)) parts.push(`Location: ${event.location}`);
  return [parts.join("\n")];
}

/**
 * Assembles embeddable text for a meeting note.
 * Chunk 0: `[Meeting Notes] {title} — {summary}`
 * Chunks 1+: transcript flattened and chunked via chunkText()
 */
export function assembleMeetingNoteText(note: MeetingNoteAssemblerInput): string[] {
  const headerParts: string[] = [`[Meeting Notes] ${note.title}`];
  if (present(note.summary)) headerParts.push(note.summary);
  const header = headerParts.join(" — ");

  if (!note.transcript || note.transcript.length === 0) {
    return [header];
  }

  const flatTranscript = note.transcript
    .map((entry) => `${entry.speaker}: ${entry.text}`)
    .join("\n");

  const transcriptChunks = chunkText(flatTranscript);
  return [header, ...transcriptChunks];
}

/**
 * Assembles embeddable text for a scout finding.
 * Format: `[Scout Finding] {title}\n{description}\nRelevance: {reasoning}`
 */
export function assembleFindingText(finding: FindingAssemblerInput): string[] {
  const parts: string[] = [`[Scout Finding] ${finding.title}`];
  if (present(finding.description)) parts.push(finding.description);
  if (present(finding.reasoning)) parts.push(`Relevance: ${finding.reasoning}`);
  return [parts.join("\n")];
}

/**
 * Assembles embeddable text for a conversation.
 * Filters to user/assistant roles, joins with double newline, truncates to maxEmbeddingTextLength.
 */
export function assembleConversationText(messages: ConversationMessage[]): string[] {
  const { maxEmbeddingTextLength } = AI_CONFIG.memory;

  const filtered = messages.filter(
    (m) => m.role === "user" || m.role === "assistant"
  );

  const joined = filtered
    .map((m) => `${m.role}: ${m.content}`)
    .join("\n\n");

  return [joined.slice(0, maxEmbeddingTextLength)];
}
