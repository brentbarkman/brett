import { SECURITY_BLOCK } from "../context/system-prompts.js";

// Prompt builder + schema for meeting action-item extraction.
// Exported here so eval harness and apps/api call the same thing.

export interface ActionItemsPromptInput {
  userName: string;
  meetingTitle: string;
  meetingDate: string;
  attendees: Array<{ name: string; email: string }>;
  summary: string;
}

// Pre-compute the reference dates the model needs to resolve relative date
// phrases ("by Friday", "end of week", "next Monday"). Haiku 4.5 consistently
// gets calendar math off-by-one when left to compute this itself, so we hand
// it the answers directly.
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function computeDateRefs(meetingDateISO: string): string {
  const d = new Date(meetingDateISO + "T00:00:00Z");
  const dow = d.getUTCDay();
  const dayName = DAY_NAMES[dow];
  const iso = (x: Date) => x.toISOString().split("T")[0];

  // Build the whole meeting-week (Monday..Sunday) so the model can resolve
  // "by Tuesday" / "on Thursday" etc. to the exact date without math.
  // Week is Monday-indexed — if meeting is Sunday, that Sunday belongs to
  // the preceding Monday-Sunday week.
  const daysSinceMon = dow === 0 ? 6 : dow - 1;
  const weekStart = new Date(d);
  weekStart.setUTCDate(d.getUTCDate() - daysSinceMon);

  const weekdays: string[] = [];
  for (let i = 0; i < 7; i++) {
    const day = new Date(weekStart);
    day.setUTCDate(weekStart.getUTCDate() + i);
    weekdays.push(`${DAY_NAMES[(1 + i) % 7]}: ${iso(day)}`);
  }

  const nextMonday = new Date(weekStart);
  nextMonday.setUTCDate(weekStart.getUTCDate() + 7);

  const nextFriday = new Date(nextMonday);
  nextFriday.setUTCDate(nextMonday.getUTCDate() + 4);

  const tomorrow = new Date(d);
  tomorrow.setUTCDate(d.getUTCDate() + 1);

  return [
    `Meeting date: ${meetingDateISO} (${dayName})`,
    `Tomorrow: ${iso(tomorrow)}`,
    ``,
    `This week (Mon-Sun):`,
    ...weekdays.map((w) => `  ${w}`),
    ``,
    `Next Monday: ${iso(nextMonday)}`,
    `End of next week (Friday): ${iso(nextFriday)}`,
  ].join("\n");
}

/** Produces the system + user message pair for action-item extraction. */
export function buildActionItemsPrompt(input: ActionItemsPromptInput): { system: string; user: string } {
  const attendeeList = input.attendees.length > 0
    ? input.attendees.map((a) => `${a.name} <${a.email}>`).join(", ")
    : "No attendee information available";

  const system = `You extract structured action items from meeting notes. Return only valid JSON.

Analyze the meeting summary and extract action items. For each one, determine:
1. Whether it's for the user ("me") or someone else ("other")
2. A clear, concise task title
3. A due date if mentioned or clearly implied

Title guidelines:
- Remove the user's name from all titles — never start with the user's name
- Make titles actionable verbs ("Send proposal" not "Proposal needs to be sent")
- For the user's own tasks (assignee=me): just the action ("Send revised proposal to Dan")
- For other people's tasks (assignee=other): format as "Follow up: {name} to {action}" — e.g. "Follow up: Dan to send revised proposal"
- Keep titles concise (under 100 chars)
- Don't include the meeting name unless it adds clarity

Name matching (IMPORTANT):
- Use the EXACT form the meeting summary uses when referring to a person, both in titles and in assigneeName.
- If the summary says "Jen" but the attendee list has "Jennifer Martinez", use "Jen" in assigneeName AND in the title — the summary is the source of truth for how the user thinks of this person.
- Only fall back to the attendee-list name if the summary never names the person.

Due date guidelines:
- Use the Reference dates block in the user message — do NOT compute weekday math yourself.
- "by {Weekday}" / "on {Weekday}" / "end of {Weekday}" → use the exact date from the "This week" table for that weekday.
- "end of week" / "by Friday" → use the Friday entry from the "This week" table.
- "next week" / "next Monday" → use "Next Monday".
- "end of next week" → use "End of next week (Friday)".
- "tomorrow" → use "Tomorrow".
- Only set dueDate when explicitly stated or strongly implied. Leave null if uncertain.

If no action items exist, return an empty array [].

${SECURITY_BLOCK}`;

  const user = `The user is: ${input.userName}
Meeting: "${input.meetingTitle}" on ${input.meetingDate}
Attendees: ${attendeeList}

## Reference dates (use these verbatim — do not recompute)
${computeDateRefs(input.meetingDate)}

<user_data label="meeting_summary">
${input.summary}
</user_data>`;

  return { system, user };
}

// NOTE: Haiku 4.5 (and OpenAI strict mode) require additionalProperties: false
// at EVERY object level in json_schema responseFormat, otherwise the API returns
// a 400. Without this the schema broke all action-item extraction on Haiku 4.5 —
// caught by the eval harness on first real run.
export const ACTION_ITEMS_SCHEMA = {
  type: "object" as const,
  properties: {
    items: {
      type: "array" as const,
      items: {
        type: "object" as const,
        properties: {
          assignee: { type: "string" as const, enum: ["me", "other"] },
          assigneeName: { type: "string" as const },
          title: { type: "string" as const },
          dueDate: { type: ["string", "null"] as const },
        },
        required: ["assignee", "title", "dueDate"],
        additionalProperties: false,
      },
    },
  },
  required: ["items"],
  additionalProperties: false,
};
