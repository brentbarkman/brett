import { describe, it, expect } from "vitest";
import { detectContentType } from "../lib/url-detector.js";

describe("detectContentType", () => {
  it("detects tweet from x.com/user/status/", () => {
    expect(detectContentType("https://x.com/user/status/123456")).toBe("tweet");
  });
  it("detects tweet from twitter.com", () => {
    expect(detectContentType("https://twitter.com/user/status/123456")).toBe("tweet");
  });
  it("detects article from x.com/user/article/", () => {
    expect(detectContentType("https://x.com/user/article/some-title")).toBe("article");
  });
  it("detects video from youtube.com", () => {
    expect(detectContentType("https://youtube.com/watch?v=abc")).toBe("video");
  });
  it("detects video from youtu.be", () => {
    expect(detectContentType("https://youtu.be/abc")).toBe("video");
  });
  it("detects podcast from spotify episode", () => {
    expect(detectContentType("https://open.spotify.com/episode/abc")).toBe("podcast");
  });
  it("detects podcast from apple podcasts", () => {
    expect(detectContentType("https://podcasts.apple.com/us/podcast/show/id123")).toBe("podcast");
  });
  it("detects pdf from .pdf extension", () => {
    expect(detectContentType("https://example.com/doc.pdf")).toBe("pdf");
  });
  it("detects article from medium.com", () => {
    expect(detectContentType("https://medium.com/some-article")).toBe("article");
  });
  it("detects article from substack", () => {
    expect(detectContentType("https://lennysnewsletter.substack.com/p/some-post")).toBe("article");
  });
  it("defaults to web_page for unknown URLs", () => {
    expect(detectContentType("https://example.com/page")).toBe("web_page");
  });
});
