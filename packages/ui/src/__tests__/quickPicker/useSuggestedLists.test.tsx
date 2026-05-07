import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import type { NavList } from "@brett/types";
import { useSuggestedLists } from "../../quickPicker/useSuggestedLists";

const lists: NavList[] = [
  { id: "1", name: "Board Memo", count: 14, completedCount: 0, colorClass: "bg-amber-400", sortOrder: 0 },
  { id: "2", name: "Q2 Planning", count: 8, completedCount: 0, colorClass: "bg-blue-400", sortOrder: 1 },
  { id: "3", name: "Family", count: 3, completedCount: 0, colorClass: "bg-emerald-400", sortOrder: 2 },
  { id: "4", name: "Reading", count: 21, completedCount: 0, colorClass: "bg-orange-400", sortOrder: 3 },
  { id: "5", name: "Investing", count: 12, completedCount: 0, colorClass: "bg-violet-400", sortOrder: 4 },
];

describe("useSuggestedLists", () => {
  it("returns AI suggestions when present, in order, mode='suggested'", () => {
    const { result } = renderHook(() =>
      useSuggestedLists({
        lists,
        aiSuggestions: [
          { listId: "5", listName: "Investing", similarity: 0.9 },
          { listId: "3", listName: "Family", similarity: 0.7 },
        ],
        recentListIds: ["1", "2"],
      }),
    );
    expect(result.current.mode).toBe("suggested");
    expect(result.current.chips.map((l) => l.id)).toEqual(["5", "3"]);
  });

  it("falls back to recent when AI suggestions are empty, mode='recent'", () => {
    const { result } = renderHook(() =>
      useSuggestedLists({ lists, aiSuggestions: [], recentListIds: ["3", "1", "2"] }),
    );
    expect(result.current.mode).toBe("recent");
    expect(result.current.chips.map((l) => l.id)).toEqual(["3", "1", "2"]);
  });

  it("caps at four chips even with more inputs", () => {
    const { result } = renderHook(() =>
      useSuggestedLists({
        lists,
        aiSuggestions: [],
        recentListIds: ["1", "2", "3", "4", "5"],
      }),
    );
    expect(result.current.chips.length).toBe(4);
  });

  it("filters out unknown list IDs (stale references)", () => {
    const { result } = renderHook(() =>
      useSuggestedLists({ lists, aiSuggestions: [], recentListIds: ["1", "999"] }),
    );
    expect(result.current.chips.map((l) => l.id)).toEqual(["1"]);
  });
});
