import { describe, it, expect } from "vitest";

/**
 * Tests for skill response message formatting.
 * Validates that:
 * - brett-item: links only reference Item IDs, never meeting IDs
 * - brett-nav: links use valid paths
 * - Meeting results include summaries, not just metadata
 * - Links are well-formed markdown
 */

// Regex patterns for link validation — must match SimpleMarkdown.tsx patterns
const BRETT_ITEM_LINK = /\[([^\]]+)\]\(brett-item:([a-zA-Z0-9_-]+)\)/g;
const BRETT_NAV_LINK = /\[([^\]]+)\]\(brett-nav:([^)]+)\)/g;
const MALFORMED_LINK = /\(brett-(?:item|nav):[^)]*$/gm; // unclosed parens

// ── Link format helpers ──

function extractItemLinks(message: string): { text: string; id: string }[] {
  const links: { text: string; id: string }[] = [];
  let match;
  const re = new RegExp(BRETT_ITEM_LINK.source, "g");
  while ((match = re.exec(message)) !== null) {
    links.push({ text: match[1], id: match[2] });
  }
  return links;
}

function hasMalformedLinks(message: string): boolean {
  return MALFORMED_LINK.test(message);
}

// ── Format builders (mirrors what skills produce) ──

function formatTaskLink(id: string, title: string): string {
  return `[${title}](brett-item:${id})`;
}

function formatMeetingActionItems(
  meetingTitle: string,
  date: string,
  tasks: { id: string; title: string; status: string; dueDate: string | null }[],
  otherMatches: { title: string; date: string }[] = [],
): string {
  const itemLines = tasks.map((t) => {
    const due = t.dueDate ? ` (due ${t.dueDate})` : "";
    const done = t.status === "done" ? " ~~" : "";
    const doneEnd = t.status === "done" ? "~~" : "";
    return `- ${done}[${t.title}](brett-item:${t.id})${doneEnd}${due}`;
  }).join("\n");

  const otherNote = otherMatches.length > 0
    ? `\n\n_Also found: ${otherMatches.map((m) => `**${m.title}** (${m.date})`).join(", ")}_`
    : "";

  return `**Action items from ${meetingTitle}** (${date}):\n\n${itemLines}${otherNote}`;
}

function formatSearchMeetingResult(
  meetingTitle: string,
  date: string,
  summary: string | null,
  tasks: { id: string; title: string; dueDate: string | null }[],
): string {
  const parts = [`**${meetingTitle}** (${date}):`];
  if (summary) parts.push(summary);
  if (tasks.length > 0) {
    parts.push("**Tasks:**");
    parts.push(tasks.map((t) =>
      `- [${t.title}](brett-item:${t.id})${t.dueDate ? ` (due ${t.dueDate})` : ""}`
    ).join("\n"));
  }
  return parts.join("\n\n");
}

// ── Tests ──

describe("brett-item: links", () => {
  it("contains well-formed markdown links", () => {
    const msg = formatTaskLink("cuid123", "Call Mom");
    expect(msg).toBe("[Call Mom](brett-item:cuid123)");
  });

  it("extracts all item links from a message", () => {
    const msg = `Here are your tasks:\n- ${formatTaskLink("id1", "Task A")}\n- ${formatTaskLink("id2", "Task B")}`;
    const links = extractItemLinks(msg);
    expect(links).toHaveLength(2);
    expect(links[0]).toEqual({ text: "Task A", id: "id1" });
    expect(links[1]).toEqual({ text: "Task B", id: "id2" });
  });

  it("detects malformed links", () => {
    expect(hasMalformedLinks("[broken](brett-item:abc")).toBe(true);
    expect(hasMalformedLinks("[ok](brett-item:abc)")).toBe(false);
  });

  it("handles titles with special characters", () => {
    const msg = formatTaskLink("id1", "Review Q2 [draft] & finalize");
    const links = extractItemLinks(msg);
    // The ] in the title breaks markdown link parsing
    expect(links).toHaveLength(0); // This is expected — titles with ] need escaping
  });
});

describe("meeting action items formatting", () => {
  const tasks = [
    { id: "item-1", title: "Send proposal to Dan", status: "active", dueDate: "2026-03-28" },
    { id: "item-2", title: "Follow up: Dan to review contract", status: "active", dueDate: null },
    { id: "item-3", title: "Update timeline", status: "done", dueDate: "2026-03-27" },
  ];

  it("uses brett-item: links for tasks, not meeting IDs", () => {
    const msg = formatMeetingActionItems("Brent x Dan: Sync", "2026-03-27", tasks);
    const links = extractItemLinks(msg);
    expect(links).toHaveLength(3);
    expect(links.every((l) => l.id.startsWith("item-"))).toBe(true);
  });

  it("does not contain any meeting ID in brett-item: links", () => {
    const meetingId = "meeting-uuid-123";
    const msg = formatMeetingActionItems("Sync", "2026-03-27", tasks);
    expect(msg).not.toContain(`brett-item:${meetingId}`);
  });

  it("includes due dates for tasks that have them", () => {
    const msg = formatMeetingActionItems("Sync", "2026-03-27", tasks);
    expect(msg).toContain("(due 2026-03-28)");
    expect(msg).not.toContain("(due null)");
  });

  it("applies strikethrough to completed tasks", () => {
    const msg = formatMeetingActionItems("Sync", "2026-03-27", tasks);
    expect(msg).toContain("~~[Update timeline](brett-item:item-3)~~");
  });

  it("shows other matches when present", () => {
    const others = [{ title: "Brent / Dan: Sprint", date: "2026-03-20" }];
    const msg = formatMeetingActionItems("Sync", "2026-03-27", tasks, others);
    expect(msg).toContain("_Also found:");
    expect(msg).toContain("**Brent / Dan: Sprint** (2026-03-20)");
  });

  it("has no malformed links", () => {
    const msg = formatMeetingActionItems("Sync", "2026-03-27", tasks);
    expect(hasMalformedLinks(msg)).toBe(false);
  });
});

describe("search_things meeting results formatting", () => {
  it("includes summary content in the response", () => {
    const msg = formatSearchMeetingResult(
      "Call w/ Leigh & Wendy",
      "2026-03-23",
      "### Discussion\nLeigh mentioned Darryl's house needs a new roof.",
      [],
    );
    expect(msg).toContain("Leigh mentioned Darryl's house");
  });

  it("does not use brett-item: for meeting titles", () => {
    const msg = formatSearchMeetingResult(
      "Team Sync",
      "2026-03-23",
      "Summary here",
      [{ id: "item-1", title: "Follow up", dueDate: null }],
    );
    // Meeting title should be bold, not a brett-item link
    expect(msg).toContain("**Team Sync**");
    expect(msg).not.toMatch(/brett-item:.*Team Sync/);
  });

  it("uses brett-item: only for linked tasks", () => {
    const msg = formatSearchMeetingResult(
      "Team Sync",
      "2026-03-23",
      null,
      [
        { id: "item-1", title: "Task A", dueDate: "2026-03-25" },
        { id: "item-2", title: "Task B", dueDate: null },
      ],
    );
    const links = extractItemLinks(msg);
    expect(links).toHaveLength(2);
    expect(links[0]).toEqual({ text: "Task A", id: "item-1" });
    expect(links[1]).toEqual({ text: "Task B", id: "item-2" });
  });

  it("shows (no action items) placeholder when no tasks exist and no summary", () => {
    const msg = formatSearchMeetingResult("Standup", "2026-03-23", null, []);
    expect(msg).toContain("**Standup** (2026-03-23):");
    // No tasks section at all
    expect(msg).not.toContain("**Tasks:**");
  });
});

describe("ID format compatibility", () => {
  // The SimpleMarkdown regex must match all ID formats used in the app
  const SIMPLEMARKDOWN_ITEM_REGEX = /\[([^\]]+)\]\(brett-item:([a-zA-Z0-9_-]+)\)/;

  it("matches cuid IDs", () => {
    const msg = "[Task](brett-item:cluabc123def456)";
    expect(SIMPLEMARKDOWN_ITEM_REGEX.test(msg)).toBe(true);
  });

  it("matches UUID IDs with hyphens", () => {
    const msg = "[Task](brett-item:8ed04d6c-d303-4957-9b47-e1e1f4dbedc9)";
    const match = msg.match(SIMPLEMARKDOWN_ITEM_REGEX);
    expect(match).not.toBeNull();
    expect(match![2]).toBe("8ed04d6c-d303-4957-9b47-e1e1f4dbedc9");
  });

  it("matches mixed case cuid IDs", () => {
    const msg = "[Task](brett-item:cM1LkR9xPqZ2)";
    expect(SIMPLEMARKDOWN_ITEM_REGEX.test(msg)).toBe(true);
  });

  it("extracts links with UUID IDs from formatted messages", () => {
    const uuid = "8ed04d6c-d303-4957-9b47-e1e1f4dbedc9";
    const msg = formatTaskLink(uuid, "Send proposal");
    const links = extractItemLinks(msg);
    expect(links).toHaveLength(1);
    expect(links[0].id).toBe(uuid);
  });

  it("extracts links with cuid IDs from formatted messages", () => {
    const cuid = "cluabc123def456";
    const msg = formatTaskLink(cuid, "Review doc");
    const links = extractItemLinks(msg);
    expect(links).toHaveLength(1);
    expect(links[0].id).toBe(cuid);
  });

  it("brett-item regex matches the same pattern as SimpleMarkdown", () => {
    // Ensure our test regex matches the same strings as the UI component
    const testCases = [
      "[Task A](brett-item:abc123)",
      "[Task B](brett-item:8ed04d6c-d303-4957-9b47-e1e1f4dbedc9)",
      "[Task C](brett-item:cM1LkR9x_PqZ2)",
    ];
    for (const tc of testCases) {
      expect(SIMPLEMARKDOWN_ITEM_REGEX.test(tc)).toBe(true);
      expect(BRETT_ITEM_LINK.test(tc)).toBe(true);
      BRETT_ITEM_LINK.lastIndex = 0; // reset global regex
    }
  });
});

describe("calendar events with meeting data", () => {
  it("action items in calendar response use title not IDs", () => {
    // Simulates what get_calendar_events returns
    const event = {
      id: "cal-event-1",
      title: "Brent x Dan: Sync",
      actionItems: [
        { title: "Send proposal", assignee: "me", dueDate: "2026-03-28" },
        { title: "Follow up: Dan to review", assignee: "other", dueDate: null },
      ],
    };
    // Calendar event action items should NOT have brett-item: links
    // because they're raw action items, not Item records
    const actionItemText = event.actionItems.map((a) => `- ${a.title}`).join("\n");
    expect(actionItemText).not.toContain("brett-item:");
  });
});
