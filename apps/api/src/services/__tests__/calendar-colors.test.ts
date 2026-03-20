import { describe, it, expect } from "vitest";
import { googleColorToGlass, getGlassColorForEvent } from "../calendar-colors.js";

describe("googleColorToGlass", () => {
  it("maps a blue-ish hex to blue glass", () => {
    const result = googleColorToGlass("#4285f4");
    expect(result.name).toBe("blue");
    expect(result.bg).toContain("rgba");
  });

  it("maps a red-ish hex to red glass", () => {
    expect(googleColorToGlass("#dc2626").name).toBe("red");
  });

  it("maps a green-ish hex to green glass", () => {
    expect(googleColorToGlass("#16a765").name).toBe("green");
  });

  it("returns a default for unknown colors", () => {
    expect(googleColorToGlass("#000000").name).toBeDefined();
  });
});

describe("getGlassColorForEvent", () => {
  it("uses event colorId when present", () => {
    const result = getGlassColorForEvent("1", "5", {
      event: { "1": { background: "#a4bdfc" } },
      calendar: { "5": { background: "#ff0000" } },
    });
    expect(result.name).toBeDefined();
  });

  it("falls back to calendar colorId", () => {
    const result = getGlassColorForEvent(null, "5", {
      event: {},
      calendar: { "5": { background: "#ff0000" } },
    });
    expect(result.name).toBe("red");
  });

  it("returns default when no color info", () => {
    expect(getGlassColorForEvent(null, null, { event: {}, calendar: {} }).name).toBe("blue");
  });
});
