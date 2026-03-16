import { describe, it, expect } from "vitest";
import { slugify } from "../index";

describe("slugify", () => {
  it("lowercases and trims", () => {
    expect(slugify("  Hello World  ")).toBe("hello-world");
  });

  it("replaces spaces with hyphens", () => {
    expect(slugify("my list name")).toBe("my-list-name");
  });

  it("replaces underscores with hyphens", () => {
    expect(slugify("my_list_name")).toBe("my-list-name");
  });

  it("removes special characters", () => {
    expect(slugify("hello!@$%world")).toBe("helloworld");
  });

  it("collapses multiple hyphens", () => {
    expect(slugify("hello---world")).toBe("hello-world");
  });

  it("strips leading and trailing hyphens", () => {
    expect(slugify("-hello-world-")).toBe("hello-world");
  });

  it("preserves emoji", () => {
    expect(slugify("🚀 Launches")).toBe("🚀-launches");
    expect(slugify("🎨 Design")).toBe("🎨-design");
  });

  it("preserves unicode letters", () => {
    expect(slugify("café résumé")).toBe("café-résumé");
  });

  it("handles empty string", () => {
    expect(slugify("")).toBe("");
  });

  it("handles string of only special characters", () => {
    expect(slugify("!@$%")).toBe("");
  });
});
