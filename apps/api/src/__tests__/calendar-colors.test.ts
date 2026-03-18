import { describe, it, expect } from "vitest";
import { getGlassColorForEvent } from "../services/calendar-colors.js";

const colorMap = {
  event: {
    "1": { background: "#7986cb" },    // lavender → blue
    "2": { background: "#33b679" },    // sage → green
    "11": { background: "#dc2626" },   // red
  },
  calendar: {
    "14": { background: "#f09300" },   // orange
    "17": { background: "#9a68af" },   // purple
  },
};

describe("getGlassColorForEvent", () => {
  it("uses event-specific color when available (priority 1)", () => {
    const glass = getGlassColorForEvent("2", "14", colorMap);
    expect(glass.name).toBe("green");
  });

  it("falls back to calendar color when event color is null (priority 2)", () => {
    const glass = getGlassColorForEvent(null, "14", colorMap);
    expect(glass.name).toBe("orange");
  });

  it("falls back to calendar color when event colorId not in map", () => {
    const glass = getGlassColorForEvent("999", "17", colorMap);
    expect(glass.name).toBe("purple");
  });

  it("returns default blue when both are null", () => {
    const glass = getGlassColorForEvent(null, null, colorMap);
    expect(glass.name).toBe("blue");
  });

  it("returns default blue when both IDs are missing from map", () => {
    const glass = getGlassColorForEvent("999", "999", colorMap);
    expect(glass.name).toBe("blue");
  });

  it("handles undefined colorIds", () => {
    const glass = getGlassColorForEvent(undefined, undefined, colorMap);
    expect(glass.name).toBe("blue");
  });

  it("handles empty color map", () => {
    const glass = getGlassColorForEvent("1", "14", { event: {}, calendar: {} });
    expect(glass.name).toBe("blue");
  });
});
