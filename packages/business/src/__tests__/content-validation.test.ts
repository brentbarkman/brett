import { describe, it, expect } from "vitest";
import { validateCreateItem, validateUpdateItem, itemToThing, detectUrl } from "../index";
import type { ItemRecord } from "@brett/types";

function makeContentItem(overrides: Partial<ItemRecord> = {}): ItemRecord & { list: { name: string } } {
  return {
    id: "item-1",
    type: "content",
    status: "active",
    title: "Test Article",
    description: null,
    source: "medium.com",
    sourceUrl: "https://medium.com/test-article",
    dueDate: null,
    dueDatePrecision: null,
    completedAt: null,
    snoozedUntil: null,
    brettObservation: null,
    notes: null,
    reminder: null,
    recurrence: null,
    recurrenceRule: null,
    brettTakeGeneratedAt: null,
    contentType: "article",
    contentStatus: "extracted",
    contentTitle: "Original Title",
    contentDescription: "An article about testing",
    contentImageUrl: "https://miro.medium.com/image.jpg",
    contentBody: "# Article body\n\nSome content here.",
    contentFavicon: "https://medium.com/favicon.ico",
    contentDomain: "medium.com",
    contentMetadata: { type: "article", author: "Test Author", publishDate: "2026-03-01" },
    meetingNoteId: null,
    listId: null,
    sourceId: null,
    userId: "user-1",
    createdAt: new Date("2026-03-10T10:00:00Z"),
    updatedAt: new Date("2026-03-13T10:00:00Z"),
    list: { name: "Reading" },
    ...overrides,
  };
}

describe("validateCreateItem — content", () => {
  it("accepts content type with sourceUrl", () => {
    const result = validateCreateItem({
      type: "content",
      title: "https://medium.com/article",
      sourceUrl: "https://medium.com/article",
    });
    expect(result.ok).toBe(true);
  });

  it("accepts content type with contentType", () => {
    const result = validateCreateItem({
      type: "content",
      title: "https://youtube.com/watch?v=abc",
      sourceUrl: "https://youtube.com/watch?v=abc",
      contentType: "video",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.contentType).toBe("video");
  });

  it("rejects invalid contentType", () => {
    const result = validateCreateItem({
      type: "content",
      title: "Test",
      sourceUrl: "https://example.com",
      contentType: "banana",
    });
    expect(result.ok).toBe(false);
  });
});

describe("validateUpdateItem — content fields", () => {
  it("accepts contentStatus update", () => {
    const result = validateUpdateItem({ contentStatus: "extracted" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.contentStatus).toBe("extracted");
  });

  it("rejects invalid contentStatus", () => {
    const result = validateUpdateItem({ contentStatus: "banana" });
    expect(result.ok).toBe(false);
  });

  it("accepts contentBody within size limit", () => {
    const result = validateUpdateItem({ contentBody: "Some article text" });
    expect(result.ok).toBe(true);
  });

  it("rejects contentBody over 500KB", () => {
    const result = validateUpdateItem({ contentBody: "x".repeat(500_001) });
    expect(result.ok).toBe(false);
  });

  it("accepts contentMetadata as object", () => {
    const result = validateUpdateItem({
      contentMetadata: { type: "article", author: "Test" },
    });
    expect(result.ok).toBe(true);
  });

  it("accepts null to clear content fields", () => {
    const result = validateUpdateItem({
      contentBody: null,
      contentTitle: null,
      contentDescription: null,
    });
    expect(result.ok).toBe(true);
  });
});

describe("detectUrl", () => {
  it("detects https:// URLs", () => {
    expect(detectUrl("https://medium.com/article")).toEqual({ isUrl: true, url: "https://medium.com/article" });
  });
  it("detects http:// URLs", () => {
    expect(detectUrl("http://example.com")).toEqual({ isUrl: true, url: "http://example.com" });
  });
  it("detects youtube.com without protocol", () => {
    expect(detectUrl("youtube.com/watch?v=abc")).toEqual({ isUrl: true, url: "https://youtube.com/watch?v=abc" });
  });
  it("detects x.com/user/status/123", () => {
    expect(detectUrl("x.com/user/status/123")).toEqual({ isUrl: true, url: "https://x.com/user/status/123" });
  });
  it("detects lennysnewsletter.substack.com/p/some-post", () => {
    expect(detectUrl("lennysnewsletter.substack.com/p/some-post")).toEqual({ isUrl: true, url: "https://lennysnewsletter.substack.com/p/some-post" });
  });
  it("detects somesite.com/article", () => {
    expect(detectUrl("somesite.com/article")).toEqual({ isUrl: true, url: "https://somesite.com/article" });
  });
  it("rejects plain text", () => {
    expect(detectUrl("buy groceries")).toEqual({ isUrl: false });
  });
  it("rejects text with spaces even with dot", () => {
    expect(detectUrl("fix the api.controller bug")).toEqual({ isUrl: false });
  });
  it("rejects version numbers", () => {
    expect(detectUrl("v2.0.1")).toEqual({ isUrl: false });
  });
  it("rejects file.pdf (no domain structure)", () => {
    expect(detectUrl("file.pdf")).toEqual({ isUrl: false });
  });
  it("rejects config.local", () => {
    expect(detectUrl("config.local")).toEqual({ isUrl: false });
  });
  it("rejects myapp.test", () => {
    expect(detectUrl("myapp.test")).toEqual({ isUrl: false });
  });
});

describe("itemToThing — content fields", () => {
  it("maps content fields to Thing", () => {
    const item = makeContentItem();
    const thing = itemToThing(item);
    expect(thing.contentType).toBe("article");
    expect(thing.contentStatus).toBe("extracted");
    expect(thing.contentDomain).toBe("medium.com");
    expect(thing.contentImageUrl).toBe("https://miro.medium.com/image.jpg");
  });

  it("omits content fields for tasks", () => {
    const item = makeContentItem({
      type: "task",
      contentType: null,
      contentStatus: null,
      contentDomain: null,
      contentImageUrl: null,
    });
    const thing = itemToThing(item);
    expect(thing.contentType).toBeUndefined();
    expect(thing.contentStatus).toBeUndefined();
  });
});
