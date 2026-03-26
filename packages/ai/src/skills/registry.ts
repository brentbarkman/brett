import type { Skill } from "./types.js";
import type { ToolDefinition } from "../providers/types.js";

// Core skills sent on every request (~9 tools, ~700 tokens instead of ~1,600)
const CORE_SKILLS = new Set([
  "create_task", "create_content", "search_things", "list_today", "complete_task",
  "get_item_detail", "get_calendar_events", "get_next_event", "up_next",
]);

// Keyword patterns that hint at needing specific tool groups
const TOOL_HINTS: Record<string, string[]> = {
  list: ["create_list", "archive_list", "get_list_items", "list_inbox", "list_upcoming", "move_to_list"],
  content: ["create_content"],
  snooze: ["snooze_item"],
  update: ["update_item"],
  settings: ["change_settings"],
  feedback: ["submit_feedback"],
  help: ["explain_feature"],
  stats: ["get_stats"],
};

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
   * Context-aware tool selection — sends core tools + any tools
   * hinted at by the user's message. Saves ~1,000 tokens per request
   * vs sending all 21 tools every time.
   */
  toToolDefinitionsForMessage(message: string): ToolDefinition[] {
    const lower = message.toLowerCase();

    // Complex requests (long messages or multiple action words) get ALL tools.
    // The token savings from keyword filtering aren't worth it when missing a
    // tool causes the LLM to fail on multi-step requests.
    const actionWords = lower.match(/\b(create|make|move|add|put|delete|remove|archive|update|change|set|snooze|complete|done|mark)\b/g);
    const isComplex = lower.length > 80 || (actionWords && actionWords.length >= 2);

    if (isComplex) {
      return this.toToolDefinitions();
    }

    // Simple requests get core tools + keyword-matched extras
    const needed = new Set<string>(CORE_SKILLS);

    for (const [keyword, skills] of Object.entries(TOOL_HINTS)) {
      if (lower.includes(keyword)) {
        for (const s of skills) needed.add(s);
      }
    }

    if (lower.match(/\b(move|put|add to)\b/)) needed.add("move_to_list");
    if (lower.match(/\b(create|make|new)\b.*\b(list|project|folder)\b/)) needed.add("create_list");
    if (lower.match(/\b(edit|change|update|rename|set)\b/)) needed.add("update_item");
    if (lower.match(/\b(inbox|unassigned)\b/)) needed.add("list_inbox");
    if (lower.match(/\b(upcoming|next week|later)\b/)) needed.add("list_upcoming");
    if (lower.match(/\b(save|article|podcast|video|web)\b/) || lower.match(/https?:\/\//)) needed.add("create_content");
    if (lower.match(/\b(snooze|later|remind)\b/)) needed.add("snooze_item");

    return Array.from(needed)
      .map((name) => this.skills.get(name))
      .filter((s): s is Skill => !!s)
      .map((s) => ({ name: s.name, description: s.description, parameters: s.parameters }));
  }

  getNoKeySkills(): Skill[] {
    return this.getAll().filter((s) => !s.requiresAI);
  }
}
