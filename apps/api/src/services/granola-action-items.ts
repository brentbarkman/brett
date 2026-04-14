import { prisma } from "../lib/prisma.js";
import { decryptToken } from "../lib/encryption.js";
import { getProvider, resolveModel, logUsage, SECURITY_BLOCK } from "@brett/ai";
import type { AIProvider } from "@brett/ai";
import type { AIProviderName, ModelTier } from "@brett/types";
import { validateCreateItem } from "@brett/business";
import { publishSSE } from "../lib/sse.js";

interface ExtractedActionItem {
  assignee: "me" | "other";
  assigneeName?: string;
  title: string;
  dueDate: string | null; // ISO date YYYY-MM-DD
}

interface ExtractionInput {
  summary: string;
  meetingTitle: string;
  meetingDate: string; // ISO date
  userName: string;
  attendees: { name: string; email: string }[];
}

/**
 * Get an AI provider for a user from their stored config.
 * Returns null if no AI is configured.
 */
async function getAIProviderForUser(userId: string): Promise<{
  provider: AIProvider;
  providerName: AIProviderName;
} | null> {
  const config = await prisma.userAIConfig.findFirst({
    where: { userId, isActive: true, isValid: true },
  });
  if (!config) return null;

  try {
    const apiKey = decryptToken(config.encryptedKey);
    const provider = getProvider(config.provider as AIProviderName, apiKey);
    return { provider, providerName: config.provider as AIProviderName };
  } catch {
    return null;
  }
}

/**
 * Use AI to extract structured action items from a meeting summary.
 * Falls back to regex if AI is unavailable.
 */
async function aiExtractActionItems(
  provider: AIProvider,
  providerName: AIProviderName,
  input: ExtractionInput,
  userId?: string,
): Promise<ExtractedActionItem[]> {
  const attendeeList = input.attendees.length > 0
    ? input.attendees.map((a) => `${a.name} <${a.email}>`).join(", ")
    : "No attendee information available";

  const systemPrompt = `You extract structured action items from meeting notes. Return only valid JSON.

Analyze the meeting summary and extract action items. For each one, determine:
1. Whether it's for the user ("me") or someone else ("other")
2. A clear, concise task title
3. A due date if mentioned or clearly implied

Title guidelines:
- Remove the user's name from all titles — never start with the user's name
- Make titles actionable verbs ("Send proposal" not "Proposal needs to be sent")
- For the user's own tasks (assignee=me): just the action ("Send revised proposal to Dan")
- For other people's tasks (assignee=other): format as "Follow up: {name} to {action}" — e.g. "Follow up: Dan to send revised proposal"
- Use the casual/short name used in the meeting (e.g. "Dan" not "Daniel Cole" if the summary says "Dan")
- Keep titles concise (under 100 chars)
- Don't include the meeting name unless it adds clarity

Due date guidelines:
- "end of week" = the Friday of the meeting's week
- "next week" = the Monday after the meeting
- Only set dueDate when explicitly stated or strongly implied
- Leave null if uncertain

If no action items exist, return an empty array [].

${SECURITY_BLOCK}`;

  const prompt = `The user is: ${input.userName}
Meeting: "${input.meetingTitle}" on ${input.meetingDate}
Attendees: ${attendeeList}
Today's date for reference: ${input.meetingDate}

<user_data label="meeting_summary">
${input.summary}
</user_data>`;

  const model = resolveModel(providerName, "small" as ModelTier);
  let result = "";

  for await (const chunk of provider.chat({
    model,
    messages: [{ role: "user", content: prompt }],
    system: systemPrompt,
    temperature: 0.1,
    maxTokens: 2048,
    responseFormat: {
      type: "json_schema",
      name: "action_items",
      schema: {
        type: "object",
        properties: {
          items: {
            type: "array",
            items: {
              type: "object",
              properties: {
                assignee: { type: "string", enum: ["me", "other"] },
                assigneeName: { type: "string" },
                title: { type: "string" },
                dueDate: { type: ["string", "null"] },
              },
              required: ["assignee", "title", "dueDate"],
            },
          },
        },
        required: ["items"],
      },
    },
  })) {
    if (chunk.type === "text") {
      result += chunk.content;
    }
    if (chunk.type === "done" && userId) {
      logUsage(prisma, {
        userId,
        provider: providerName,
        model,
        modelTier: "small",
        source: "action_item_extraction",
        inputTokens: chunk.usage.input,
        outputTokens: chunk.usage.output,
      }).catch(() => {});
    }
  }

  try {
    // Strip markdown fencing if model ignores structured output constraint
    const cleaned = result
      .replace(/^```(?:json)?\s*\n?/m, "")
      .replace(/\n?```\s*$/m, "")
      .trim();
    const parsed = JSON.parse(cleaned);
    const items: unknown[] = Array.isArray(parsed) ? parsed : parsed?.items ?? [];
    return items.filter(
      (item: unknown): item is ExtractedActionItem =>
        typeof item === "object" &&
        item !== null &&
        "assignee" in item &&
        "title" in item &&
        typeof (item as ExtractedActionItem).title === "string" &&
        (item as ExtractedActionItem).title.length > 3,
    );
  } catch (err) {
    console.warn("[granola-action-items] Failed to parse AI response:", err);
    return [];
  }
}

/**
 * Regex fallback for when AI is not configured.
 * Extracts items from action-item-like headers in Granola summaries.
 */
function regexExtractActionItems(summary: string): ExtractedActionItem[] {
  const items: { title: string }[] = [];

  const headerPattern = /###?\s*(?:next steps|action items?|follow[- ]?ups?|todos?|takeaways)\s*\n([\s\S]*?)(?=\n###?\s|$)/gi;
  let headerMatch;
  while ((headerMatch = headerPattern.exec(summary)) !== null) {
    const block = headerMatch[1];
    const linePattern = /^(?:\d+\.\s+|[-*•]\s+)(.+)/gm;
    let lineMatch;
    while ((lineMatch = linePattern.exec(block)) !== null) {
      const title = lineMatch[1].trim();
      if (title.length > 3 && title.length < 200) {
        items.push({ title });
      }
    }
  }

  const labelPatterns = [
    /^[-*•]\s*(?:action item|todo|task|follow[- ]?up):\s*(.+)/gim,
    /^[-*•]\s*\[[ x]?\]\s*(.+)/gim,
  ];
  for (const pattern of labelPatterns) {
    let match;
    while ((match = pattern.exec(summary)) !== null) {
      const title = match[1].trim();
      if (title.length > 3 && title.length < 200) {
        items.push({ title });
      }
    }
  }

  const seen = new Set<string>();
  return items
    .filter((item) => {
      const key = item.title.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((item) => ({
      assignee: "me" as const,
      title: item.title,
      dueDate: null,
    }));
}

/**
 * Process action items for a synced meeting.
 * Uses AI when available, falls back to regex.
 * Called OUTSIDE the meeting creation transaction.
 */
export async function processActionItems(
  meetingNoteId: string,
  calendarEventId: string | null,
  userId: string,
  summary: string,
  meetingTitle: string,
  meetingDate: Date,
  attendees: { name: string; email: string }[],
): Promise<void> {
  if (!summary.trim()) return;

  // Get user info for AI prompt
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true },
  });

  let extracted: ExtractedActionItem[];

  const ai = await getAIProviderForUser(userId);
  if (ai) {
    extracted = await aiExtractActionItems(ai.provider, ai.providerName, {
      summary,
      meetingTitle,
      meetingDate: meetingDate.toISOString().slice(0, 10),
      userName: user?.name ?? "the user",
      attendees,
    }, userId);
  } else {
    extracted = regexExtractActionItems(summary);
  }

  if (extracted.length === 0) return;

  // Store all extracted items on the meeting record (always, regardless of settings)
  await prisma.meetingNote.update({
    where: { id: meetingNoteId },
    data: {
      actionItems: extracted.map((item) => ({
        title: item.title,
        assignee: item.assignee,
        assigneeName: item.assigneeName,
        dueDate: item.dueDate,
      })),
    },
  });

  // Check user preferences for which items to auto-create
  const account = await prisma.granolaAccount.findUnique({
    where: { userId },
    select: { autoCreateMyTasks: true, autoCreateFollowUps: true },
  });
  const createMyTasks = account?.autoCreateMyTasks ?? true;
  const createFollowUps = account?.autoCreateFollowUps ?? true;

  // Create tasks based on preferences
  let createdCount = 0;
  for (const item of extracted) {
    // Skip based on assignee and user preferences
    if (item.assignee === "me" && !createMyTasks) continue;
    if (item.assignee === "other" && !createFollowUps) continue;

    const validation = validateCreateItem({
      type: "task",
      title: item.title,
      source: "Granola",
    });
    if (!validation.ok) continue;

    await prisma.item.create({
      data: {
        type: "task",
        title: validation.data.title,
        source: "Granola",
        status: "active",
        userId,
        meetingNoteId,
        dueDate: item.dueDate ? new Date(item.dueDate + "T00:00:00") : null,
        dueDatePrecision: item.dueDate ? "day" : null,
      },
    });
    createdCount++;
  }

  if (createdCount > 0) {
    publishSSE(userId, {
      type: "granola.action_items.created",
      payload: { count: createdCount, meetingNoteId },
    });
  }
}

/**
 * Reprocess action items for an existing meeting.
 * Deletes existing Granola-sourced items and re-extracts.
 */
export async function reprocessActionItems(
  meetingNoteId: string,
  userId: string,
): Promise<{ created: number }> {
  const meeting = await prisma.meetingNote.findUnique({
    where: { id: meetingNoteId, userId },
    select: {
      id: true,
      calendarEventId: true,
      title: true,
      summary: true,
      meetingStartedAt: true,
      attendees: true,
    },
  });
  if (!meeting) throw new Error("Meeting not found");
  if (!meeting.summary) return { created: 0 };

  // Delete existing items sourced from this meeting
  await prisma.item.deleteMany({
    where: { meetingNoteId, userId, source: "Granola" },
  });

  // Clear stored action items
  await prisma.meetingNote.update({
    where: { id: meetingNoteId },
    data: { actionItems: undefined },
  });

  const attendees = Array.isArray(meeting.attendees)
    ? (meeting.attendees as { name: string; email: string }[])
    : [];

  await processActionItems(
    meeting.id,
    meeting.calendarEventId,
    userId,
    meeting.summary,
    meeting.title,
    meeting.meetingStartedAt,
    attendees,
  );

  const newCount = await prisma.item.count({
    where: { meetingNoteId, userId, source: "Granola" },
  });

  return { created: newCount };
}
