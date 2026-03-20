import { describe, it, expect } from "vitest";
import { hexToHue, googleColorToGlass } from "../index";

describe("hexToHue", () => {
  it("converts pure red to 0", () => {
    expect(hexToHue("#ff0000")).toBe(0);
  });

  it("converts pure green to 120", () => {
    expect(hexToHue("#00ff00")).toBe(120);
  });

  it("converts pure blue to 240", () => {
    expect(hexToHue("#0000ff")).toBe(240);
  });

  it("converts white/grey (no saturation) to 0", () => {
    expect(hexToHue("#808080")).toBe(0);
    expect(hexToHue("#ffffff")).toBe(0);
    expect(hexToHue("#000000")).toBe(0);
  });

  it("handles hex without hash prefix", () => {
    expect(hexToHue("ff0000")).toBe(0);
  });

  it("converts Google blue (#4285f4) to blue range", () => {
    const hue = hexToHue("#4285f4");
    expect(hue).toBeGreaterThanOrEqual(210);
    expect(hue).toBeLessThan(250);
  });
});

describe("googleColorToGlass", () => {
  it("maps Google default blue to blue glass", () => {
    const glass = googleColorToGlass("#4285f4");
    expect(glass.name).toBe("blue");
  });

  it("maps red hex to red glass", () => {
    const glass = googleColorToGlass("#dc2626");
    expect(glass.name).toBe("red");
  });

  it("maps green hex to green glass", () => {
    const glass = googleColorToGlass("#16a34a");
    expect(glass.name).toBe("green");
  });

  it("maps purple hex to indigo/purple range", () => {
    const glass = googleColorToGlass("#9333ea");
    // #9333ea hue ~270 falls in indigo range (250-280)
    expect(glass.name).toBe("indigo");
  });

  it("maps Google Calendar Sage (#33b679) to green glass", () => {
    const glass = googleColorToGlass("#33b679");
    expect(glass.name).toBe("green");
  });

  it("maps Google Calendar Lavender (#7986cb) to blue glass", () => {
    const glass = googleColorToGlass("#7986cb");
    expect(glass.name).toBe("blue");
  });

  it("maps Google Calendar Flamingo (#e67c73) to red glass", () => {
    const glass = googleColorToGlass("#e67c73");
    expect(glass.name).toBe("red");
  });

  it("maps Google Calendar Banana (#e6c800) to amber glass", () => {
    const glass = googleColorToGlass("#e6c800");
    expect(glass.name).toBe("amber");
  });

  it("returns object with bg, border, text, name", () => {
    const glass = googleColorToGlass("#4285f4");
    expect(glass).toHaveProperty("bg");
    expect(glass).toHaveProperty("border");
    expect(glass).toHaveProperty("text");
    expect(glass).toHaveProperty("name");
    expect(glass.bg).toMatch(/^rgba\(/);
    expect(glass.border).toMatch(/^rgba\(/);
    expect(glass.text).toMatch(/^rgb\(/);
  });

  it("defaults for achromatic colors (hue 0 → red range)", () => {
    // Grey has hue 0, which falls in red's wrap-around range (346-15)
    expect(googleColorToGlass("#808080").name).toBe("red");
  });
});
