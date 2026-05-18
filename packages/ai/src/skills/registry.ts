import type { Skill } from "./types.js";
import type { ToolDefinition } from "../providers/types.js";

// Intent-based tool groups — each request gets only the tools it needs.
// Routing guidance lives in the system prompt; tools are just capabilities.
const INTENT_GROUPS: Record<string, string[]> = {
  query: [
    "search_things", "get_item_detail", "list_today", "list_upcoming",
    "list_inbox", "get_list_items", "get_calendar_events", "get_next_event",
    "up_next", "get_stats", "list_scouts",
    "get_meeting_notes", "get_meeting_action_items", "analyze_meeting_pattern",
  ],
  create: [
    "create_task", "create_content", "create_list", "create_scout",
  ],
  mutate: [
    "update_item", "complete_task", "move_to_list", "snooze_item", "archive_list",
  ],
  meta: [
    "change_settings", "submit_feedback", "explain_feature",
  ],
  scout: [
    "create_scout", "list_scouts",
  ],
};

// Lookup tools needed by create/mutate to resolve IDs and list names.
// Much cheaper than pulling the full query group (~2 tools vs ~10).
const LOOKUP_TOOLS = ["search_things", "get_item_detail"];

// Regex patterns for intent classification — uses word boundaries to avoid false matches
const INTENT_PATTERNS: Array<{ intent: string; pattern: RegExp }> = [
  { intent: "create", pattern: /\b(create|make|add|new|save|remind)\b/ },
  { intent: "mutate", pattern: /\b(done|complete|finish|mark|move|put|update|edit|change|rename|set|snooze|defer|later|archive|delete|remove)\b/ },
  { intent: "query", pattern: /\b(what|when|where|show|list|how many|search|find|look|get|next|upcoming|today|inbox|schedule|meeting|calendar|stat)\b/ },
  { intent: "meta", pattern: /\b(settings?|provider|model|switch|feedback|bug|feature request|help|explain|how does)\b/ },
  { intent: "scout", pattern: /\b(monitor|scout|watch\s+for|track|keep\s+an?\s+eye\s+on)\b/i },
];

export class SkillRegistry {
  private skills = new Map<string, Skill>();

  register(skill: Skill): void {
    this.skills.set(skill.name, skill);
  }

  get(name: string): Skill | undefined {
    return this.skills.get(name);
  }

  getAll(): Skill[] {
    return Array.from(this.skills.values());
  }

  /** All tool definitions — for evals and testing */
  toToolDefinitions(): ToolDefinition[] {
    return this.getAll().map((s) => ({
      name: s.name,
      description: s.description,
      parameters: s.parameters,
    }));
  }

  /**
   * Intent-based tool selection — classifies the message (and optionally
   * a sliding window of recent prior user turns) into intents and sends
   * only the tools for matched intent groups.
   * Falls back to query + create + mutate for ambiguous messages.
   *
   * `recentUserMessages` is included to handle multi-turn refinement flows
   * where the latest turn ("just to set it up") no longer carries the
   * original intent word ("create"). Without it, a clarifying back-and-forth
   * can silently drop the create_task tool partway through the conversation.
   */
  toToolDefinitionsForMessage(
    message: string,
    recentUserMessages: string[] = [],
  ): ToolDefinition[] {
    // Classify each message independently. If a message matches no patterns,
    // it's individually ambiguous and contributes the fallback (query + create
    // + mutate) — same behavior as the original single-message path. The
    // union across the window is what gets sent to the LLM, so ambiguous
    // priors (e.g. "401k", "yes") keep create_task available even when the
    // latest turn locks in on mutate.
    const AMBIGUOUS_FALLBACK = ["query", "create", "mutate"];
    const matchedIntents = new Set<string>();
    for (const msg of [message, ...recentUserMessages]) {
      const lower = msg.toLowerCase();
      const msgIntents = new Set<string>();
      for (const { intent, pattern } of INTENT_PATTERNS) {
        if (pattern.test(lower)) {
          msgIntents.add(intent);
        }
      }
      // URL in message → likely saving content
      if (/https?:\/\//.test(lower)) {
        msgIntents.add("create");
      }
      if (msgIntents.size === 0) {
        for (const i of AMBIGUOUS_FALLBACK) msgIntents.add(i);
      }
      for (const i of msgIntents) matchedIntents.add(i);
    }

    // Collect unique tool names from matched groups
    const needed = new Set<string>();
    for (const intent of matchedIntents) {
      const group = INTENT_GROUPS[intent];
      if (group) {
        for (const name of group) needed.add(name);
      }
    }

    // Create/mutate need lookup tools to resolve IDs — but NOT the full query group.
    // "mark it complete" needs search_things + complete_task, not list_today + get_stats.
    if ((matchedIntents.has("create") || matchedIntents.has("mutate")) && !matchedIntents.has("query")) {
      for (const name of LOOKUP_TOOLS) needed.add(name);
    }

    return Array.from(needed)
      .map((name) => this.skills.get(name))
      .filter((s): s is Skill => !!s)
      .map((s) => ({ name: s.name, description: s.description, parameters: s.parameters }));
  }

  getNoKeySkills(): Skill[] {
    return this.getAll().filter((s) => !s.requiresAI);
  }
}
