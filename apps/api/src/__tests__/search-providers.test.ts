import { describe, it, expect } from "vitest";
import { classifySourceType } from "../lib/search-providers/index.js";

describe("classifySourceType", () => {
  it("classifies LinkedIn sources as entity", () => {
    expect(classifySourceType({ name: "LinkedIn", url: "https://linkedin.com/company/x" })).toBe("entity");
  });

  it("classifies Crunchbase sources as entity", () => {
    expect(classifySourceType({ name: "Funding", url: "https://crunchbase.com/org/x" })).toBe("entity");
  });

  it("classifies news sources as web", () => {
    expect(classifySourceType({ name: "Reuters", url: "https://reuters.com" })).toBe("web");
  });

  it("classifies sources without URL by name", () => {
    expect(classifySourceType({ name: "LinkedIn profiles" })).toBe("entity");
    expect(classifySourceType({ name: "SEC EDGAR" })).toBe("web");
  });

  it("URL takes priority over name for classification", () => {
    // Name says LinkedIn but URL is reuters — use URL, falls through to web
    expect(classifySourceType({ name: "My LinkedIn stuff", url: "https://reuters.com" })).toBe("web");
  });
});
