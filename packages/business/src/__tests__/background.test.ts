import { describe, it, expect } from "vitest";
import { getTimeSegment, getBusynessTier } from "../background";

describe("getTimeSegment", () => {
  it("returns dawn for 5am-6:59am", () => {
    expect(getTimeSegment(5)).toBe("dawn");
    expect(getTimeSegment(6)).toBe("dawn");
  });

  it("returns morning for 7am-11:59am", () => {
    expect(getTimeSegment(7)).toBe("morning");
    expect(getTimeSegment(11)).toBe("morning");
  });

  it("returns afternoon for 12pm-4:59pm", () => {
    expect(getTimeSegment(12)).toBe("afternoon");
    expect(getTimeSegment(16)).toBe("afternoon");
  });

  it("returns goldenHour for 5pm-6:59pm", () => {
    expect(getTimeSegment(17)).toBe("goldenHour");
    expect(getTimeSegment(18)).toBe("goldenHour");
  });

  it("returns evening for 7pm-8:59pm", () => {
    expect(getTimeSegment(19)).toBe("evening");
    expect(getTimeSegment(20)).toBe("evening");
  });

  it("returns night for 9pm-4:59am", () => {
    expect(getTimeSegment(21)).toBe("night");
    expect(getTimeSegment(0)).toBe("night");
    expect(getTimeSegment(4)).toBe("night");
  });
});

describe("getBusynessTier", () => {
  it("returns light when score <= 4", () => {
    expect(getBusynessTier(0, 0)).toBe("light");
    expect(getBusynessTier(1, 2)).toBe("light");
    expect(getBusynessTier(0, 4)).toBe("light");
    expect(getBusynessTier(2, 0)).toBe("light");
  });

  it("returns moderate when score 5-10", () => {
    expect(getBusynessTier(1, 3)).toBe("moderate");
    expect(getBusynessTier(3, 2)).toBe("moderate");
    expect(getBusynessTier(5, 0)).toBe("moderate");
    expect(getBusynessTier(0, 10)).toBe("moderate");
  });

  it("returns packed when score > 10", () => {
    expect(getBusynessTier(3, 5)).toBe("packed");
    expect(getBusynessTier(5, 1)).toBe("packed");
    expect(getBusynessTier(6, 0)).toBe("packed");
    expect(getBusynessTier(0, 11)).toBe("packed");
  });

  it("weights meetings at 2x", () => {
    expect(getBusynessTier(3, 0)).toBe("moderate");
    expect(getBusynessTier(0, 6)).toBe("moderate");
    expect(getBusynessTier(4, 3)).toBe("packed");
    expect(getBusynessTier(0, 11)).toBe("packed");
  });
});
