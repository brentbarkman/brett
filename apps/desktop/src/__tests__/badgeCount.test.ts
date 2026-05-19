import { describe, it, expect } from "vitest";
import { computeBadgeCount } from "../lib/badgeCount";

// These tests encode the invariant that the Today badge counts ONLY overdue +
// today (Tonight items live in the today bucket via dueDate). If you change
// these expectations, also update apps/ios/BrettTests/TodaySectionsTests.swift
// and the spec at docs/superpowers/specs/2026-04-24-today-count-badge-design.md.

const today = new Date("2026-05-18T12:00:00Z");

describe("computeBadgeCount", () => {
  it("counts overdue items", () => {
    const items = [
      { dueDate: "2026-05-17T12:00:00Z", isCompleted: false },
    ];
    expect(computeBadgeCount(items, today)).toBe(1);
  });

  it("counts today items", () => {
    const items = [
      { dueDate: "2026-05-18T18:00:00Z", isCompleted: false },
    ];
    expect(computeBadgeCount(items, today)).toBe(1);
  });

  it("counts tonight items as today (they live in the today bucket)", () => {
    // Tonight items have dueDate = end of today, so the same predicate
    // catches them. No special handling needed.
    const items = [
      { dueDate: "2026-05-18T23:00:00Z", isCompleted: false },
    ];
    expect(computeBadgeCount(items, today)).toBe(1);
  });

  it("excludes this_week items", () => {
    const items = [
      { dueDate: "2026-05-20T12:00:00Z", isCompleted: false },
    ];
    expect(computeBadgeCount(items, today)).toBe(0);
  });

  it("excludes this_weekend items even on a weekend", () => {
    // Critical regression guard: before 2026-05-18, the badge included
    // weekend items on Sat/Sun. The new spec drops that — weekend items
    // never count unless they're already overdue.
    const saturday = new Date("2026-05-23T12:00:00Z");
    const weekendItems = [
      { dueDate: "2026-05-24T12:00:00Z", isCompleted: false },
    ];
    expect(computeBadgeCount(weekendItems, saturday)).toBe(0);
  });

  it("excludes completed items", () => {
    const items = [
      { dueDate: "2026-05-18T18:00:00Z", isCompleted: true },
    ];
    expect(computeBadgeCount(items, today)).toBe(0);
  });

  it("excludes items with no dueDate", () => {
    const items = [{ dueDate: null, isCompleted: false }];
    expect(computeBadgeCount(items, today)).toBe(0);
  });
});
