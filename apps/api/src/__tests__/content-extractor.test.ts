import { describe, it, expect } from "vitest";
import { parseOgTags } from "../lib/content-extractor.js";

describe("parseOgTags", () => {
  it("extracts og:title and og:description", () => {
    const html = `
      <html><head>
        <meta property="og:title" content="Test Title" />
        <meta property="og:description" content="Test Description" />
      </head><body></body></html>
    `;
    const result = parseOgTags(html, "https://example.com/page");
    expect(result.title).toBe("Test Title");
    expect(result.description).toBe("Test Description");
  });

  it("extracts og:image and og:type", () => {
    const html = `
      <html><head>
        <meta property="og:image" content="https://example.com/image.jpg" />
        <meta property="og:type" content="article" />
      </head><body></body></html>
    `;
    const result = parseOgTags(html, "https://example.com/page");
    expect(result.imageUrl).toBe("https://example.com/image.jpg");
    expect(result.ogType).toBe("article");
  });

  it("extracts favicon from link rel=icon", () => {
    const html = `
      <html><head>
        <link rel="icon" href="https://example.com/custom-favicon.png" />
      </head><body></body></html>
    `;
    const result = parseOgTags(html, "https://example.com/page");
    expect(result.favicon).toBe("https://example.com/custom-favicon.png");
  });

  it("resolves relative favicon paths", () => {
    const html = `
      <html><head>
        <link rel="icon" href="/assets/favicon.ico" />
      </head><body></body></html>
    `;
    const result = parseOgTags(html, "https://example.com/page");
    expect(result.favicon).toBe("https://example.com/assets/favicon.ico");
  });

  it("falls back to /favicon.ico when no link tag found", () => {
    const html = `<html><head></head><body></body></html>`;
    const result = parseOgTags(html, "https://example.com/page");
    expect(result.favicon).toBe("https://example.com/favicon.ico");
  });

  it("extracts domain from URL", () => {
    const html = `<html><head></head><body></body></html>`;
    const result = parseOgTags(html, "https://www.example.com/some/path");
    expect(result.domain).toBe("example.com");
  });

  it("falls back to twitter:title when og:title is missing", () => {
    const html = `
      <html><head>
        <meta name="twitter:title" content="Twitter Title" />
      </head><body></body></html>
    `;
    const result = parseOgTags(html, "https://example.com/page");
    expect(result.title).toBe("Twitter Title");
  });

  it("handles meta tags with content before property", () => {
    const html = `
      <html><head>
        <meta content="Reversed Title" property="og:title" />
      </head><body></body></html>
    `;
    const result = parseOgTags(html, "https://example.com/page");
    expect(result.title).toBe("Reversed Title");
  });
});
