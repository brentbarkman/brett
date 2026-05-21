import { describe, it, expect, beforeEach } from "vitest";
import { SkillRegistry } from "../registry.js";
import type { Skill, SkillContext, SkillResult } from "../types.js";

function makeSkill(overrides: Partial<Skill> = {}): Skill {
  return {
    name: "test_skill",
    description: "A test skill",
    parameters: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
    modelTier: "small",
    requiresAI: false,
    execute: async (_params: unknown, _ctx: SkillContext): Promise<SkillResult> => ({
      success: true,
      message: "done",
    }),
    ...overrides,
  };
}

describe("SkillRegistry", () => {
  let registry: SkillRegistry;

  beforeEach(() => {
    registry = new SkillRegistry();
  });

  it("registers and retrieves a skill by name", () => {
    const skill = makeSkill();
    registry.register(skill);
    expect(registry.get("test_skill")).toBe(skill);
  });

  it("returns undefined for unknown skill name", () => {
    expect(registry.get("nonexistent")).toBeUndefined();
  });

  it("getAll returns all registered skills", () => {
    const s1 = makeSkill({ name: "skill_a" });
    const s2 = makeSkill({ name: "skill_b" });
    registry.register(s1);
    registry.register(s2);
    const all = registry.getAll();
    expect(all).toHaveLength(2);
    expect(all).toContain(s1);
    expect(all).toContain(s2);
  });

  it("overwriting a skill by the same name replaces it", () => {
    const original = makeSkill({ description: "original" });
    const replacement = makeSkill({ description: "replacement" });
    registry.register(original);
    registry.register(replacement);
    expect(registry.getAll()).toHaveLength(1);
    expect(registry.get("test_skill")?.description).toBe("replacement");
  });

  it("toToolDefinitions returns correct shape for all skills", () => {
    const s1 = makeSkill({ name: "skill_a", description: "desc A" });
    const s2 = makeSkill({ name: "skill_b", description: "desc B" });
    registry.register(s1);
    registry.register(s2);
    const defs = registry.toToolDefinitions();
    expect(defs).toHaveLength(2);
    expect(defs[0]).toEqual({
      name: "skill_a",
      description: "desc A",
      parameters: s1.parameters,
    });
    expect(defs[1]).toEqual({
      name: "skill_b",
      description: "desc B",
      parameters: s2.parameters,
    });
  });

  it("getNoKeySkills returns only skills where requiresAI is false", () => {
    const noKey = makeSkill({ name: "no_key", requiresAI: false });
    const withKey = makeSkill({ name: "with_key", requiresAI: true });
    registry.register(noKey);
    registry.register(withKey);
    const result = registry.getNoKeySkills();
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("no_key");
  });

  it("getNoKeySkills returns empty array when all skills require AI", () => {
    registry.register(makeSkill({ name: "a", requiresAI: true }));
    registry.register(makeSkill({ name: "b", requiresAI: true }));
    expect(registry.getNoKeySkills()).toHaveLength(0);
  });

  it("getNoKeySkills returns all skills when none require AI", () => {
    registry.register(makeSkill({ name: "a", requiresAI: false }));
    registry.register(makeSkill({ name: "b", requiresAI: false }));
    expect(registry.getNoKeySkills()).toHaveLength(2);
  });

  it("empty registry returns empty arrays", () => {
    expect(registry.getAll()).toHaveLength(0);
    expect(registry.toToolDefinitions()).toHaveLength(0);
    expect(registry.getNoKeySkills()).toHaveLength(0);
  });

  describe("toToolDefinitionsForMessage — intent-routed meeting queries", () => {
    // Regression: the "query" intent group filters tools before they reach
    // the LLM. Meeting-retrieval skills (get_meeting_notes, get_meeting_action_items)
    // were omitted from the group, so the LLM never saw them for messages like
    // "what were the notes from my Friday meeting with Yves" and fell back to
    // wrong tools (get_item_detail / search_things), failing to retrieve notes
    // that were already correctly stored and linked.
    beforeEach(() => {
      registry.register(makeSkill({ name: "get_meeting_notes" }));
      registry.register(makeSkill({ name: "get_meeting_action_items" }));
      registry.register(makeSkill({ name: "search_things" }));
      registry.register(makeSkill({ name: "get_item_detail" }));
    });

    it("exposes get_meeting_notes to the LLM for a meeting-notes query", () => {
      const tools = registry.toToolDefinitionsForMessage(
        "what were the notes from my Friday meeting with Yves",
      );
      expect(tools.map((t) => t.name)).toContain("get_meeting_notes");
    });

    it("exposes get_meeting_action_items to the LLM for an action-items query", () => {
      const tools = registry.toToolDefinitionsForMessage(
        "show me the action items from my last meeting",
      );
      expect(tools.map((t) => t.name)).toContain("get_meeting_action_items");
    });
  });

  describe("toToolDefinitionsForMessage — multi-turn intent propagation", () => {
    // Regression for issue #170. In a multi-turn create flow, the latest
    // user message may not carry create-intent words even though the
    // conversation is clearly about creating a task. Without the history
    // window, the LLM was sent only mutate tools (search/update/move/...)
    // and hallucinated "I don't have a create tool available right now".
    //
    // Reproduces Brent's "401k" flow:
    //   user: "401k"           → no patterns match → fallback (create + query + mutate)
    //   asst: "want me to create one? what action — rollover, contribution, …?"
    //   user: "yes"            → no patterns → fallback
    //   asst: "what's the specific action?"
    //   user: "just to set it up" → `set` matches MUTATE only → create_task gets dropped
    beforeEach(() => {
      registry.register(makeSkill({ name: "create_task" }));
      registry.register(makeSkill({ name: "update_item" }));
      registry.register(makeSkill({ name: "complete_task" }));
      registry.register(makeSkill({ name: "move_to_list" }));
      registry.register(makeSkill({ name: "snooze_item" }));
      registry.register(makeSkill({ name: "archive_list" }));
      registry.register(makeSkill({ name: "search_things" }));
      registry.register(makeSkill({ name: "get_item_detail" }));
    });

    it("preserves create_task when prior user turns implied a create intent", () => {
      const tools = registry.toToolDefinitionsForMessage(
        "just to set it up",
        ["401k", "yes"],
      );
      expect(tools.map((t) => t.name)).toContain("create_task");
    });

    it("ignores history when the latest message itself has clear create intent", () => {
      const tools = registry.toToolDefinitionsForMessage(
        "create a task to call mom",
        ["what's on today"],
      );
      const names = tools.map((t) => t.name);
      expect(names).toContain("create_task");
    });

    it("backward-compatible: single-message call still works (no history arg)", () => {
      const tools = registry.toToolDefinitionsForMessage("just to set it up");
      const names = tools.map((t) => t.name);
      expect(names).toContain("update_item");
      // Without history, create_task is correctly absent — pre-existing behavior.
      expect(names).not.toContain("create_task");
    });
  });
});
