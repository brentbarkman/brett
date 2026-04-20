import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { demoMode, displayTitle } from "./demoMode";

describe("demoMode", () => {
  beforeEach(() => {
    window.localStorage.clear();
    demoMode.set(false);
  });

  afterEach(() => {
    demoMode.set(false);
    window.localStorage.clear();
  });

  describe("displayTitle (disabled)", () => {
    it("returns the real title when demo mode is off", () => {
      expect(displayTitle("abc", "Meet with Sarah about Q3", "thing")).toBe(
        "Meet with Sarah about Q3",
      );
      expect(displayTitle("xyz", "Board meeting", "calendar")).toBe("Board meeting");
    });

    it("passes through even when id is missing (off)", () => {
      expect(displayTitle(null, "Real", "thing")).toBe("Real");
      expect(displayTitle(undefined, "Real", "calendar")).toBe("Real");
      expect(displayTitle("", "Real", "thing")).toBe("Real");
    });
  });

  describe("displayTitle (enabled)", () => {
    beforeEach(() => {
      demoMode.set(true);
    });

    it("returns a fake title that is not the real one", () => {
      const fake = displayTitle("thing-123", "Call mom", "thing");
      expect(fake).not.toBe("Call mom");
      expect(typeof fake).toBe("string");
      expect(fake.length).toBeGreaterThan(0);
    });

    it("is stable across repeated calls with the same id", () => {
      const first = displayTitle("stable-id", "Real", "thing");
      const second = displayTitle("stable-id", "Real", "thing");
      const third = displayTitle("stable-id", "Different real title", "thing");
      expect(second).toBe(first);
      expect(third).toBe(first);
    });

    it("is stable across demoMode toggles", () => {
      const before = displayTitle("toggle-id", "Real", "thing");
      demoMode.set(false);
      demoMode.set(true);
      const after = displayTitle("toggle-id", "Real", "thing");
      expect(after).toBe(before);
    });

    it("keeps thing and calendar pools disjoint", () => {
      // Scan a range of ids; no calendar fake should appear in the thing pool or vice versa.
      const thingOutputs = new Set<string>();
      const calendarOutputs = new Set<string>();
      for (let i = 0; i < 500; i++) {
        thingOutputs.add(displayTitle(`id-${i}`, "Real", "thing"));
        calendarOutputs.add(displayTitle(`id-${i}`, "Real", "calendar"));
      }
      for (const t of thingOutputs) {
        expect(calendarOutputs.has(t)).toBe(false);
      }
    });

    it("falls back to the real title when id is missing", () => {
      expect(displayTitle(null, "Fallback", "thing")).toBe("Fallback");
      expect(displayTitle(undefined, "Fallback", "calendar")).toBe("Fallback");
      expect(displayTitle("", "Fallback", "thing")).toBe("Fallback");
    });

    it("distributes reasonably across the pool (no single phrase hogs)", () => {
      const counts = new Map<string, number>();
      const N = 500;
      for (let i = 0; i < N; i++) {
        const fake = displayTitle(`uuid-${i}-xxxx-${i * 7}`, "Real", "thing");
        counts.set(fake, (counts.get(fake) ?? 0) + 1);
      }
      // With 60 phrases and 500 ids, uniform ≈ 8.3 per phrase. Allow up to 3x as sanity.
      const max = Math.max(...counts.values());
      expect(max).toBeLessThanOrEqual(25);
      // At least half the pool should be used.
      expect(counts.size).toBeGreaterThanOrEqual(30);
    });
  });

  describe("store", () => {
    it("notifies subscribers synchronously on toggle", () => {
      let notifications = 0;
      const unsub = demoMode.subscribe(() => {
        notifications++;
      });
      demoMode.toggle();
      expect(notifications).toBe(1);
      demoMode.toggle();
      expect(notifications).toBe(2);
      unsub();
      demoMode.toggle();
      expect(notifications).toBe(2);
    });

    it("does not notify when set to the current value", () => {
      let notifications = 0;
      const unsub = demoMode.subscribe(() => {
        notifications++;
      });
      demoMode.set(false); // already false
      expect(notifications).toBe(0);
      demoMode.set(true);
      expect(notifications).toBe(1);
      demoMode.set(true); // already true
      expect(notifications).toBe(1);
      unsub();
    });

    it("persists to localStorage", () => {
      demoMode.set(true);
      expect(window.localStorage.getItem("brett:demoMode")).toBe("1");
      demoMode.set(false);
      expect(window.localStorage.getItem("brett:demoMode")).toBe("0");
    });
  });
});
