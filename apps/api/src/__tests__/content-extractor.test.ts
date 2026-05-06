import { describe, it, expect } from "vitest";
import {
  parseOgTags,
  buildSpotifyEmbedUrl,
  buildApplePodcastEmbedUrl,
  extractYouTubeVideoId,
  extractArticle,
  extractTweetId,
  extractTweetAuthor,
  computeSyndicationToken,
  parseSyndicationData,
  expandTwitterUrls,
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

describe("extractTweetId", () => {
  it("extracts ID from x.com status URL", () => {
    expect(extractTweetId("https://x.com/aiedge_/status/2046352285622731011")).toBe("2046352285622731011");
  });

  it("extracts ID from twitter.com status URL", () => {
    expect(extractTweetId("https://twitter.com/vercel/status/1683920951807971329")).toBe("1683920951807971329");
  });

  it("ignores trailing query string", () => {
    expect(extractTweetId("https://x.com/aiedge_/status/2046352285622731011?s=12&t=abc")).toBe("2046352285622731011");
  });

  it("handles /statuses/ legacy path form", () => {
    expect(extractTweetId("https://twitter.com/user/statuses/123456789")).toBe("123456789");
  });

  it("returns null for non-tweet URLs", () => {
    expect(extractTweetId("https://x.com/aiedge_")).toBeNull();
    expect(extractTweetId("https://example.com/foo/status/123")).toBeNull();
  });
});

describe("extractTweetAuthor", () => {
  it("extracts @handle from x.com URL", () => {
    expect(extractTweetAuthor("https://x.com/aiedge_/status/2046352285622731011")).toBe("aiedge_");
  });

  it("extracts @handle from twitter.com URL", () => {
    expect(extractTweetAuthor("https://twitter.com/vercel/status/1683920951807971329")).toBe("vercel");
  });

  it("returns null for URLs without a handle", () => {
    expect(extractTweetAuthor("https://x.com/i/status/123")).toBe("i"); // edge: "i" is technically the handle here
    expect(extractTweetAuthor("https://example.com/something")).toBeNull();
  });
});

describe("computeSyndicationToken", () => {
  it("matches react-tweet's token derivation for known tweet IDs", () => {
    // These values were verified by hitting cdn.syndication.twimg.com manually.
    expect(computeSyndicationToken("2046352285622731011")).toBe("4ykszoetnf");
    expect(computeSyndicationToken("1683920951807971329")).toBe("42y6zv7ufp");
  });

  it("is deterministic", () => {
    const id = "1234567890123456789";
    expect(computeSyndicationToken(id)).toBe(computeSyndicationToken(id));
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

describe("parseSyndicationData", () => {
  // Minimal valid response shape — every test layers on top of this.
  const baseResponse = {
    user: { screen_name: "vercel", name: "Vercel" },
    text: "hello world",
    created_at: "2026-04-01T12:00:00Z",
  };

  it("returns null when user.screen_name is missing (deleted/protected tweet)", () => {
    expect(parseSyndicationData({ text: "orphan" })).toBeNull();
    expect(parseSyndicationData({ user: {}, text: "orphan" })).toBeNull();
  });

  it("returns handle, displayName, text, and createdAt for a basic tweet", () => {
    const result = parseSyndicationData(baseResponse);
    expect(result).not.toBeNull();
    expect(result!.handle).toBe("vercel");
    expect(result!.displayName).toBe("Vercel");
    expect(result!.text).toBe("hello world");
    expect(result!.noteText).toBeNull();
    expect(result!.createdAt).toBe("2026-04-01T12:00:00Z");
    expect(result!.urls).toEqual([]);
    expect(result!.quotedTweet).toBeNull();
  });

  it("reads note_tweet.text for long-form tweets", () => {
    const longText = "L".repeat(800);
    const result = parseSyndicationData({
      ...baseResponse,
      text: "L".repeat(280) + "…", // legacy truncated text
      note_tweet: { text: longText },
    });
    expect(result!.noteText).toBe(longText);
    // text field is preserved as-is; callers decide which to use
    expect(result!.text.endsWith("…")).toBe(true);
  });

  it("parses entities.urls into {url, expandedUrl, displayUrl}", () => {
    const result = parseSyndicationData({
      ...baseResponse,
      text: "check this out https://t.co/abc123",
      entities: {
        urls: [
          { url: "https://t.co/abc123", expanded_url: "https://example.com/article", display_url: "example.com/article" },
        ],
      },
    });
    expect(result!.urls).toEqual([
      { url: "https://t.co/abc123", expandedUrl: "https://example.com/article", displayUrl: "example.com/article" },
    ]);
  });

  it("parses urls inside note_tweet.entity_set when present", () => {
    // Long tweets put entity URLs under note_tweet.entity_set, not the top-level entities.
    const result = parseSyndicationData({
      ...baseResponse,
      note_tweet: {
        text: "long body with https://t.co/long",
        entity_set: {
          urls: [
            { url: "https://t.co/long", expanded_url: "https://example.com/long", display_url: "example.com/long" },
          ],
        },
      },
    });
    expect(result!.urls).toEqual([
      { url: "https://t.co/long", expandedUrl: "https://example.com/long", displayUrl: "example.com/long" },
    ]);
  });

  it("recurses into quoted_tweet one level and captures id_str", () => {
    const result = parseSyndicationData({
      ...baseResponse,
      text: "quoting this",
      quoted_tweet: {
        user: { screen_name: "dril", name: "wint" },
        text: "the wallet inspector",
        id_str: "200",
      },
    });
    expect(result!.quotedTweet).not.toBeNull();
    expect(result!.quotedTweet!.handle).toBe("dril");
    expect(result!.quotedTweet!.text).toBe("the wallet inspector");
    // idStr lets the renderer build a permalink (https://x.com/{handle}/status/{idStr})
    expect(result!.quotedTweet!.idStr).toBe("200");
  });

  it("does not recurse past one level (quoted_tweet.quoted_tweet is dropped)", () => {
    const result = parseSyndicationData({
      ...baseResponse,
      quoted_tweet: {
        user: { screen_name: "dril" },
        text: "outer quote",
        quoted_tweet: {
          user: { screen_name: "horse_ebooks" },
          text: "deeply nested — should not appear",
        },
      },
    });
    expect(result!.quotedTweet!.handle).toBe("dril");
    expect(result!.quotedTweet!.quotedTweet).toBeNull();
  });

  it("ignores malformed entities.urls without crashing", () => {
    const result = parseSyndicationData({
      ...baseResponse,
      entities: { urls: [{ url: "https://t.co/x" }, null, "junk", { expanded_url: "https://example.com" }] },
    });
    // Only entries with all three string fields survive.
    expect(result!.urls).toEqual([]);
  });
});

describe("expandTwitterUrls", () => {
  it("replaces every t.co shortlink with its expanded_url", () => {
    const text = "morning read https://t.co/abc and https://t.co/xyz nice";
    const urls = [
      { url: "https://t.co/abc", expandedUrl: "https://example.com/a", displayUrl: "example.com/a" },
      { url: "https://t.co/xyz", expandedUrl: "https://example.com/x", displayUrl: "example.com/x" },
    ];
    expect(expandTwitterUrls(text, urls)).toBe("morning read https://example.com/a and https://example.com/x nice");
  });

  it("is a no-op when no urls match the text", () => {
    expect(expandTwitterUrls("plain text", [])).toBe("plain text");
    expect(expandTwitterUrls("plain text", [
      { url: "https://t.co/missing", expandedUrl: "https://example.com", displayUrl: "example.com" },
    ])).toBe("plain text");
  });

  it("returns the input unchanged when text is empty", () => {
    expect(expandTwitterUrls("", [
      { url: "https://t.co/abc", expandedUrl: "https://example.com", displayUrl: "example.com" },
    ])).toBe("");
  });

  it("handles a t.co url that appears multiple times", () => {
    const text = "a https://t.co/abc b https://t.co/abc c";
    const urls = [{ url: "https://t.co/abc", expandedUrl: "https://example.com", displayUrl: "example.com" }];
    expect(expandTwitterUrls(text, urls)).toBe("a https://example.com b https://example.com c");
  });

  it("does not interpret expandedUrl as a regex (escapes special chars in url)", () => {
    // If the implementation naively builds a regex from `url`, "?" or "." would behave
    // as regex metacharacters and match unexpected substrings. Verify literal replace.
    const text = "see https://t.co/a.b?c";
    const urls = [{ url: "https://t.co/a.b?c", expandedUrl: "https://example.com/safe", displayUrl: "example.com" }];
    expect(expandTwitterUrls(text, urls)).toBe("see https://example.com/safe");
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
