import { describe, it, expect } from "vitest";
import {
  parseOgTags,
  buildSpotifyEmbedUrl,
  buildApplePodcastEmbedUrl,
  extractYouTubeVideoId,
  extractArticle,
} from "../lib/content-extractor.js";
// cleanFilename is from @brett/ui — import directly since API doesn't depend on ui package
function cleanFilename(filename: string): string {
  return filename
    .replace(/\.pdf$/i, "")
    .replace(/[-_]+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
import { sanitizeFilename } from "../lib/sanitize-filename.js";

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

  it("strips style tags before parsing to prevent CSS ReDoS", () => {
    const html = `
      <html><head>
        <meta property="og:title" content="Safe Title" />
        <style>.evil { background: red; }</style>
      </head><body></body></html>
    `;
    const result = parseOgTags(html, "https://example.com/page");
    expect(result.title).toBe("Safe Title");
  });
});

describe("buildSpotifyEmbedUrl", () => {
  it("converts episode URL to embed URL", () => {
    const url = "https://open.spotify.com/episode/abc123";
    expect(buildSpotifyEmbedUrl(url)).toBe("https://open.spotify.com/embed/episode/abc123");
  });

  it("returns null for non-episode URL", () => {
    expect(buildSpotifyEmbedUrl("https://open.spotify.com/album/xyz")).toBeNull();
  });
});

describe("buildApplePodcastEmbedUrl", () => {
  it("converts podcast URL to embed URL", () => {
    const url = "https://podcasts.apple.com/us/podcast/my-show/id123456";
    expect(buildApplePodcastEmbedUrl(url)).toBe("https://embed.podcasts.apple.com/us/podcast/my-show/id123456");
  });

  it("returns null for non-podcast URL", () => {
    expect(buildApplePodcastEmbedUrl("https://example.com/not-a-podcast")).toBeNull();
  });
});

describe("extractYouTubeVideoId", () => {
  it("extracts ID from youtube.com/watch", () => {
    expect(extractYouTubeVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });

  it("extracts ID from youtu.be", () => {
    expect(extractYouTubeVideoId("https://youtu.be/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });

  it("returns null for non-YouTube URL", () => {
    expect(extractYouTubeVideoId("https://example.com/video")).toBeNull();
  });
});

describe("cleanFilename", () => {
  it("strips .pdf extension", () => {
    expect(cleanFilename("report.pdf")).toBe("Report");
  });

  it("replaces hyphens with spaces", () => {
    expect(cleanFilename("my-report.pdf")).toBe("My Report");
  });

  it("replaces underscores with spaces", () => {
    expect(cleanFilename("my_report.pdf")).toBe("My Report");
  });

  it("collapses consecutive separators", () => {
    expect(cleanFilename("my--report.pdf")).toBe("My Report");
  });

  it("handles mixed consecutive separators", () => {
    expect(cleanFilename("my-_-report.pdf")).toBe("My Report");
  });
});

describe("extractArticle", () => {
  it("extracts article content from valid HTML", () => {
    const html = `
      <html><head><title>Test</title></head>
      <body>
        <article>
          <h1>My Article</h1>
          <p>This is a real article with enough content to pass the word count threshold. It needs at least twenty words to be considered valid content by the extraction logic.</p>
        </article>
      </body></html>
    `;
    const result = extractArticle(html, "https://example.com/article");
    expect(result).not.toBeNull();
    expect(result!.wordCount).toBeGreaterThan(20);
  });

  it("returns null for JS-rendered shell pages (ScriptLoadFailure)", () => {
    const html = `
      <html><head></head>
      <body>
        <div id="ScriptLoadFailure">
          <form action="" method="GET">
            <button>Retry</button>
          </form>
        </div>
      </body></html>
    `;
    const result = extractArticle(html, "https://x.com/article/123");
    expect(result).toBeNull();
  });

  it("returns null for pages with very little content", () => {
    const html = `
      <html><head></head>
      <body><p>Just a few words.</p></body></html>
    `;
    const result = extractArticle(html, "https://example.com/page");
    expect(result).toBeNull();
  });

  it("returns null for noscript fallback pages", () => {
    const html = `
      <html><head></head>
      <body>
        <noscript>You need to enable JavaScript to run this app.</noscript>
      </body></html>
    `;
    const result = extractArticle(html, "https://example.com/spa");
    expect(result).toBeNull();
  });
});

describe("sanitizeFilename", () => {
  it("keeps safe characters", () => {
    expect(sanitizeFilename("document.pdf")).toBe("document.pdf");
  });

  it("replaces unsafe characters with underscores and collapses them", () => {
    expect(sanitizeFilename("file name (1).pdf")).toBe("file_name_1_.pdf");
  });

  it("collapses consecutive underscores", () => {
    expect(sanitizeFilename("file   name.pdf")).toBe("file_name.pdf");
  });

  it("strips path traversal", () => {
    expect(sanitizeFilename("../../etc/passwd")).toBe("passwd");
  });

  it("limits length to 255 characters", () => {
    const longName = "a".repeat(300) + ".pdf";
    expect(sanitizeFilename(longName).length).toBeLessThanOrEqual(255);
  });

  it("returns 'unnamed' for empty input", () => {
    expect(sanitizeFilename("")).toBe("unnamed");
  });
});
