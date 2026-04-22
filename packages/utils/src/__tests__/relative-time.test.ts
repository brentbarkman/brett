import { describe, it, expect } from "vitest";
import { formatRelativeTime } from "../index";

// Reference time so the tests stay deterministic regardless of execution date.
const NOW = new Date("2026-04-21T12:00:00Z");

describe("formatRelativeTime", () => {
  describe("accepts both ISO strings and Date objects", () => {
    it("ISO string input", () => {
      const fiveMinAgo = new Date(NOW.getTime() - 5 * 60_000).toISOString();
      expect(formatRelativeTime(fiveMinAgo, NOW)).toBe("5m ago");
    });

    it("Date input (covers the former computeRelativeAge callsite)", () => {
      const twoHoursAgo = new Date(NOW.getTime() - 2 * 3_600_000);
      expect(formatRelativeTime(twoHoursAgo, NOW)).toBe("2h ago");
    });
  });

  describe("bucket boundaries", () => {
    it("< 60 seconds → just now", () => {
      expect(formatRelativeTime(new Date(NOW.getTime() - 30_000), NOW)).toBe("just now");
    });

    it("exactly 60 seconds → 1m ago", () => {
      expect(formatRelativeTime(new Date(NOW.getTime() - 60_000), NOW)).toBe("1m ago");
    });

    it("59 minutes → 59m ago", () => {
      expect(formatRelativeTime(new Date(NOW.getTime() - 59 * 60_000), NOW)).toBe("59m ago");
    });

    it("60 minutes → 1h ago", () => {
      expect(formatRelativeTime(new Date(NOW.getTime() - 60 * 60_000), NOW)).toBe("1h ago");
    });

    it("23 hours → 23h ago", () => {
      expect(formatRelativeTime(new Date(NOW.getTime() - 23 * 3_600_000), NOW)).toBe("23h ago");
    });

    it("24 hours → 1d ago", () => {
      expect(formatRelativeTime(new Date(NOW.getTime() - 24 * 3_600_000), NOW)).toBe("1d ago");
    });

    it("6 days → 6d ago", () => {
      expect(formatRelativeTime(new Date(NOW.getTime() - 6 * 86_400_000), NOW)).toBe("6d ago");
    });

    it(">= 7 days → falls back to toLocaleDateString", () => {
      const eightDaysAgo = new Date(NOW.getTime() - 8 * 86_400_000);
      const result = formatRelativeTime(eightDaysAgo, NOW);
      // Just verify it's not one of the "ago" bucket labels.
      expect(result).not.toMatch(/ago$/);
      expect(result).not.toBe("just now");
    });
  });

  describe("defaults", () => {
    it("uses current time when `now` is omitted", () => {
      // Just verifies the signature works without throwing.
      const recent = new Date(Date.now() - 5_000);
      expect(formatRelativeTime(recent)).toBe("just now");
    });
  });
});
