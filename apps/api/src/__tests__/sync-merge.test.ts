import { describe, it, expect } from "vitest";
import { fieldLevelMerge, findMissingBaselines } from "../lib/sync-merge.js";

describe("findMissingBaselines", () => {
  it("returns [] when every changed field has a baseline", () => {
    expect(
      findMissingBaselines(["title", "description"], {
        title: "old",
        description: "prev",
      }),
    ).toEqual([]);
  });

  it("flags fields missing from previousValues", () => {
    expect(
      findMissingBaselines(["title", "description", "status"], {
        title: "old",
      }),
    ).toEqual(["description", "status"]);
  });

  it("treats an explicit undefined baseline as present", () => {
    // An explicit `undefined` means "field was previously unset" — different
    // from "client didn't send a baseline". `in` rather than `!== undefined`
    // is what distinguishes the two.
    expect(findMissingBaselines(["notes"], { notes: undefined })).toEqual([]);
  });

  it("handles an empty changedFields list", () => {
    expect(findMissingBaselines([], { title: "x" })).toEqual([]);
  });
});

describe("fieldLevelMerge", () => {
  it("applies the client's value when baseline matches the server", () => {
    const result = fieldLevelMerge(
      { title: "server", description: "same" },
      ["title"],
      { title: "client" },
      { title: "server" },
    );
    expect(result.mergedFields).toEqual({ title: "client" });
    expect(result.conflictedFields).toEqual([]);
    expect(result.hasChanges).toBe(true);
  });

  it("flags a conflict when the server has drifted from baseline", () => {
    const result = fieldLevelMerge(
      { title: "server-moved-on" },
      ["title"],
      { title: "client" },
      { title: "server-original" },
    );
    expect(result.mergedFields).toEqual({});
    expect(result.conflictedFields).toEqual(["title"]);
    expect(result.hasChanges).toBe(false);
  });

  it("partial merge: clean field applied, conflicted field rejected", () => {
    const result = fieldLevelMerge(
      { title: "server-title", description: "server-desc-drifted" },
      ["title", "description"],
      { title: "client-title", description: "client-desc" },
      { title: "server-title", description: "server-desc-orig" },
    );
    expect(result.mergedFields).toEqual({ title: "client-title" });
    expect(result.conflictedFields).toEqual(["description"]);
    expect(result.hasChanges).toBe(true);
  });

  it("compares dates and nulls via JSON.stringify", () => {
    const serverDate = new Date("2026-04-01T00:00:00Z");
    const result = fieldLevelMerge(
      { dueDate: serverDate },
      ["dueDate"],
      { dueDate: null },
      { dueDate: serverDate },
    );
    expect(result.mergedFields).toEqual({ dueDate: null });
    expect(result.conflictedFields).toEqual([]);
  });
});
