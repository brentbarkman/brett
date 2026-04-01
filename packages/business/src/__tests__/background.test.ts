import { describe, it, expect } from "vitest";
import { getTimeSegment, getBusynessTier, getBusynessScore, selectImage } from "../background";

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

  describe("relative mode (with avgScore)", () => {
    // avgScore = 10 → light < 7, moderate 7-13, packed > 13
    it("returns light when ratio < 0.7", () => {
      // score = 6, ratio = 0.6
      expect(getBusynessTier(2, 2, 10)).toBe("light");
      // score = 0, ratio = 0
      expect(getBusynessTier(0, 0, 10)).toBe("light");
    });

    it("returns moderate when ratio 0.7-1.3", () => {
      // score = 8, ratio = 0.8
      expect(getBusynessTier(3, 2, 10)).toBe("moderate");
      // score = 10, ratio = 1.0
      expect(getBusynessTier(3, 4, 10)).toBe("moderate");
      // score = 13, ratio = 1.3
      expect(getBusynessTier(5, 3, 10)).toBe("moderate");
    });

    it("returns packed when ratio > 1.3", () => {
      // score = 14, ratio = 1.4
      expect(getBusynessTier(5, 4, 10)).toBe("packed");
      // score = 20, ratio = 2.0
      expect(getBusynessTier(8, 4, 10)).toBe("packed");
    });

    it("falls back to fixed thresholds when avgScore is 0", () => {
      expect(getBusynessTier(0, 3, 0)).toBe("light");
      expect(getBusynessTier(3, 2, 0)).toBe("moderate");
      expect(getBusynessTier(5, 1, 0)).toBe("packed");
    });

    it("falls back to fixed thresholds when avgScore is undefined", () => {
      expect(getBusynessTier(0, 3)).toBe("light");
      expect(getBusynessTier(3, 2)).toBe("moderate");
    });
  });
});

describe("getBusynessScore", () => {
  it("computes score as meetings*2 + tasks", () => {
    expect(getBusynessScore(0, 0)).toBe(0);
    expect(getBusynessScore(3, 4)).toBe(10);
    expect(getBusynessScore(5, 1)).toBe(11);
  });
});

describe("selectImage", () => {
  const manifest = {
    version: 1,
    sets: {
      photography: {
        dawn: {
          light: ["dawn/light-1.webp", "dawn/light-2.webp", "dawn/light-3.webp"],
          moderate: ["dawn/moderate-1.webp"],
          packed: ["dawn/packed-1.webp", "dawn/packed-2.webp"],
        },
      },
      abstract: {
        dawn: {
          light: ["abstract/dawn/light-1.webp"],
          moderate: ["abstract/dawn/moderate-1.webp"],
          packed: ["abstract/dawn/packed-1.webp"],
        },
      },
    },
  };

  it("returns a URL from the correct category", () => {
    const result = selectImage(manifest, "photography", "dawn", "light", []);
    expect(manifest.sets.photography.dawn.light).toContain(result);
  });

  it("excludes already-shown images", () => {
    const exclude = ["dawn/light-1.webp", "dawn/light-2.webp"];
    const result = selectImage(manifest, "photography", "dawn", "light", exclude);
    expect(result).toBe("dawn/light-3.webp");
  });

  it("resets exclusion when all images have been shown", () => {
    const exclude = ["dawn/light-1.webp", "dawn/light-2.webp", "dawn/light-3.webp"];
    const result = selectImage(manifest, "photography", "dawn", "light", exclude);
    expect(manifest.sets.photography.dawn.light).toContain(result);
  });

  it("works with abstract set", () => {
    const result = selectImage(manifest, "abstract", "dawn", "light", []);
    expect(result).toBe("abstract/dawn/light-1.webp");
  });

  it("returns null for missing category", () => {
    const result = selectImage(manifest, "photography", "morning" as any, "light", []);
    expect(result).toBeNull();
  });
});
