import { describe, it, expect } from "vitest";
import { validateSkillArgs } from "../validate-args.js";

describe("validateSkillArgs", () => {
  const schema = {
    type: "object",
    properties: {
      query: { type: "string" },
      limit: { type: "number" },
    },
    required: ["query"],
  };

  it("returns valid for args matching schema", () => {
    const result = validateSkillArgs(schema, { query: "test", limit: 10 });
    expect(result).toEqual({ valid: true });
  });

  it("returns invalid for missing required field", () => {
    const result = validateSkillArgs(schema, { limit: 10 });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors).toContain("query");
    }
  });

  it("returns invalid for wrong type (string where number expected)", () => {
    const result = validateSkillArgs(schema, {
      query: "test",
      limit: "not-a-number",
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors).toContain("limit");
    }
  });

  it("allows extra properties by default", () => {
    const result = validateSkillArgs(schema, {
      query: "test",
      extra: "field",
    });
    expect(result).toEqual({ valid: true });
  });

  it("returns valid for empty object against schema with no required fields", () => {
    const noRequiredSchema = {
      type: "object",
      properties: {
        optional_field: { type: "string" },
      },
    };
    const result = validateSkillArgs(noRequiredSchema, {});
    expect(result).toEqual({ valid: true });
  });

  it("returns invalid for null input", () => {
    const result = validateSkillArgs(schema, null);
    expect(result.valid).toBe(false);
  });

  it("returns invalid for undefined input", () => {
    const result = validateSkillArgs(schema, undefined);
    expect(result.valid).toBe(false);
  });
});
