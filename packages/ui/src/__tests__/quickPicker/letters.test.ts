import { describe, it, expect } from "vitest";
import {
  DATE_LETTER_TO_PRESET,
  DATE_PRESET_ORDER,
  DATE_PRESET_LABELS,
} from "../../quickPicker/letters";

describe("date picker letter map", () => {
  it("maps letters to presets in the spec'd order", () => {
    expect(DATE_LETTER_TO_PRESET).toEqual({
      t: "today",
      m: "tomorrow",
      w: "this_week",
      n: "next_week",
      x: "next_month",
    });
  });

  it("exposes preset order matching chip layout (top to bottom)", () => {
    expect(DATE_PRESET_ORDER).toEqual([
      "today",
      "tomorrow",
      "this_week",
      "next_week",
      "next_month",
    ]);
  });

  it("provides display labels for every preset", () => {
    expect(DATE_PRESET_LABELS.today).toBe("Today");
    expect(DATE_PRESET_LABELS.tomorrow).toBe("Tomorrow");
    expect(DATE_PRESET_LABELS.this_week).toBe("This Week");
    expect(DATE_PRESET_LABELS.next_week).toBe("Next Week");
    expect(DATE_PRESET_LABELS.next_month).toBe("Next Month");
  });
});
