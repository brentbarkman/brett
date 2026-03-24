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
});
