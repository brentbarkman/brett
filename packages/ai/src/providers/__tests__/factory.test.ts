import { describe, it, expect } from "vitest";
import { getProvider } from "../factory.js";

describe("getProvider", () => {
  it("returns AnthropicProvider for 'anthropic'", () => {
    const provider = getProvider("anthropic", "sk-test");
    expect(provider.name).toBe("anthropic");
  });
  it("returns OpenAIProvider for 'openai'", () => {
    const provider = getProvider("openai", "sk-test");
    expect(provider.name).toBe("openai");
  });
  it("returns GoogleProvider for 'google'", () => {
    const provider = getProvider("google", "ai-test");
    expect(provider.name).toBe("google");
  });
  it("throws for unknown provider", () => {
    expect(() => getProvider("unknown" as any, "key")).toThrow();
  });
});
