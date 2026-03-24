import { describe, it, expect } from "vitest";
import { resolveModel, MODEL_MAP } from "../router.js";

describe("resolveModel", () => {
  it("resolves anthropic small", () => {
    expect(resolveModel("anthropic", "small")).toBe("claude-haiku-4-5-20251001");
  });
  it("resolves openai medium", () => {
    expect(resolveModel("openai", "medium")).toBe("gpt-4o");
  });
  it("resolves google large", () => {
    expect(resolveModel("google", "large")).toBe("gemini-2.5-pro");
  });
});
