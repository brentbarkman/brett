import type { Skill } from "./types.js";
import type { ToolDefinition } from "../providers/types.js";

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

  toToolDefinitions(): ToolDefinition[] {
    return this.getAll().map((s) => ({
      name: s.name,
      description: s.description,
      parameters: s.parameters,
    }));
  }

  getNoKeySkills(): Skill[] {
    return this.getAll().filter((s) => !s.requiresAI);
  }
}
