import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import { safeFetch, readBodyWithLimit, readBinaryWithLimit } from "./ssrf-guard.js";
import { detectContentType } from "./url-detector.js";
import { sanitizeFilename } from "./sanitize-filename.js";
import { prisma } from "./prisma.js";
import { enqueueEmbed } from "@brett/ai";
import { publishSSE } from "./sse.js";
import type { ContentType, ContentMetadata, ContentStatus } from "@brett/types";

export interface OgTags {
  title?: string;
  description?: string;
  imageUrl?: string;
  favicon?: string;
  domain: string;
  ogType?: string;
}

export function parseOgTags(html: string, url: string): OgTags {
  const parsed = new URL(url);
  const domain = parsed.hostname.replace(/^www\./, "");

  // Strip <style> tags before JSDOM parsing to prevent CSS ReDoS via pathological stylesheets
  const cleanedHtml = html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");
  // Use JSDOM for robust HTML parsing (handles mismatched quotes, special chars)
  const dom = new JSDOM(cleanedHtml, { url });
  const doc = dom.window.document;

  const getMeta = (prop: string): string | undefined => {
    const el = doc.querySelector(`meta[property="${prop}"], meta[name="${prop}"]`);
    return el?.getAttribute("content") ?? undefined;
  };

  const faviconEl = doc.querySelector('link[rel="icon"], link[rel="shortcut icon"]');
  const faviconHref = faviconEl?.getAttribute("href");
  const favicon = faviconHref
    ? faviconHref.startsWith("http") ? faviconHref : new URL(faviconHref, url).href
    : `${parsed.origin}/favicon.ico`;

  return {
    title: getMeta("og:title") ?? getMeta("twitter:title"),
    description: getMeta("og:description") ?? getMeta("twitter:description") ?? getMeta("description"),
    imageUrl: getMeta("og:image") ?? getMeta("twitter:image"),
    favicon,
    domain,
    ogType: getMeta("og:type"),
  };
}

// Note: contentBody stores Readability's cleaned HTML output, not markdown.
// The frontend renders it via DOMPurify.sanitize() + dangerouslySetInnerHTML.
// Converting to markdown was deferred — the HTML output works well enough for v1.
export function extractArticle(html: string, url: string): { content: string; wordCount: number } | null {
  // Strip <style> tags before JSDOM parsing to prevent CSS ReDoS via pathological stylesheets
  const cleanedHtml = html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");
  const dom = new JSDOM(cleanedHtml, { url });
  const reader = new Readability(dom.window.document);
  const article = reader.parse();
  if (!article?.textContent) return null;

  const content = article.content ?? article.textContent ?? "";
  const wordCount = (article.textContent ?? "").split(/\s+/).length;

  // Detect JS-rendered shell pages that Readability extracts as junk
  // (e.g., X/Twitter returns a ScriptLoadFailure page for server-side fetches)
  if (wordCount < 20 || content.includes("ScriptLoadFailure") || content.includes("noscript")) {
    return null;
  }

  return { content, wordCount };
}

async function fetchOEmbed(
  providerUrl: string,
  contentUrl: string
): Promise<Record<string, unknown> | null> {
  try {
    const oembedUrl = `${providerUrl}?url=${encodeURIComponent(contentUrl)}&format=json`;
    const res = await safeFetch(oembedUrl, { timeoutMs: 5000, maxSizeBytes: 100_000 });
    if (!res.ok) return null;
    return await res.json() as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function buildSpotifyEmbedUrl(url: string): string | null {
  // https://open.spotify.com/episode/abc → https://open.spotify.com/embed/episode/abc
  const match = url.match(/open\.spotify\.com\/(episode\/[^?#]+)/);
  return match ? `https://open.spotify.com/embed/${match[1]}` : null;
}

export function buildApplePodcastEmbedUrl(url: string): string | null {
  // https://podcasts.apple.com/us/podcast/show/id123 → https://embed.podcasts.apple.com/us/podcast/show/id123
  const match = url.match(/podcasts\.apple\.com(\/[^?#]+)/);
  return match ? `https://embed.podcasts.apple.com${match[1]}` : null;
}

export function extractYouTubeVideoId(url: string): string | null {
  const patterns = [
    /youtube\.com\/watch\?v=([^&#]+)/,
    /youtube\.com\/shorts\/([^?&#]+)/,
    /youtu\.be\/([^?&#]+)/,
  ];
  for (const re of patterns) {
    const match = url.match(re);
    if (match) return match[1];
  }
  return null;
}

interface ExtractionResult {
  contentType: ContentType;
  contentStatus: ContentStatus;
  contentTitle: string | null;
  contentDescription: string | null;
  contentImageUrl: string | null;
  contentBody: string | null;
  contentFavicon: string | null;
  contentDomain: string;
  contentMetadata: ContentMetadata;
  title?: string; // Updated title from OG tags
  needsPdfDownload?: boolean;
}

export async function extractContent(url: string): Promise<ExtractionResult> {
  const contentType = detectContentType(url);

  // For PDFs from URLs, return metadata immediately
  // PDF download + S3 upload happens in runExtraction after this returns
  if (contentType === "pdf") {
    const parsed = new URL(url);
    return {
      contentType: "pdf",
      contentStatus: "extracted",
      contentTitle: null,
      contentDescription: null,
      contentImageUrl: null,
      contentBody: null,
      contentFavicon: `${parsed.origin}/favicon.ico`,
      contentDomain: parsed.hostname.replace(/^www\./, ""),
      contentMetadata: { type: "pdf" },
      needsPdfDownload: true,
    };
  }

  // YouTube: skip page fetch entirely — oEmbed API is faster and more reliable.
  // YouTube pages are heavy JS-rendered and often hang or return useless HTML.
  if (contentType === "video") {
    const videoId = extractYouTubeVideoId(url);
    if (videoId) {
      const oembed = await fetchOEmbed("https://www.youtube.com/oembed", url);
      const parsed = new URL(url);
      return {
        contentType: "video",
        contentStatus: "extracted",
        contentTitle: (oembed?.title as string) ?? null,
        contentDescription: null,
        contentImageUrl: (oembed?.thumbnail_url as string) ?? null,
        contentBody: null,
        contentFavicon: `${parsed.origin}/favicon.ico`,
        contentDomain: parsed.hostname.replace(/^www\./, ""),
        contentMetadata: {
          type: "video",
          embedUrl: `https://www.youtube.com/embed/${videoId}`,
          channel: oembed?.author_name as string | undefined,
        },
        title: (oembed?.title as string) ?? undefined,
      };
    }
  }

  // Fetch the page
  const response = await safeFetch(url, {
    timeoutMs: 10_000,
    maxSizeBytes: 5 * 1024 * 1024,
  });

  // Check if response is actually a PDF by content-type
  const ct = response.headers.get("content-type") ?? "";
  if (ct.includes("application/pdf")) {
    const parsed = new URL(url);
    return {
      contentType: "pdf",
      contentStatus: "extracted",
      contentTitle: null,
      contentDescription: null,
      contentImageUrl: null,
      contentBody: null,
      contentFavicon: `${parsed.origin}/favicon.ico`,
      contentDomain: parsed.hostname.replace(/^www\./, ""),
      contentMetadata: { type: "pdf" },
      needsPdfDownload: true,
    };
  }

  const html = await readBodyWithLimit(response, 5 * 1024 * 1024);
  const ogTags = parseOgTags(html, url);

  const base: Omit<ExtractionResult, "contentType" | "contentMetadata" | "contentBody"> = {
    contentStatus: "extracted",
    contentTitle: ogTags.title ?? null,
    contentDescription: ogTags.description ?? null,
    contentImageUrl: ogTags.imageUrl ?? null,
    contentFavicon: ogTags.favicon ?? null,
    contentDomain: ogTags.domain,
    title: ogTags.title,
  };

  switch (contentType) {
    case "tweet": {
      const oembed = await fetchOEmbed("https://publish.twitter.com/oembed", url);
      const author = oembed?.author_name as string | undefined;
      return {
        ...base,
        contentType: "tweet",
        // Use oEmbed author for title when OG tags are blocked (common with X)
        title: base.title ?? (author ? `Tweet by ${author}` : undefined),
        contentTitle: base.contentTitle ?? (author ? `Tweet by ${author}` : null),
        contentBody: null,
        contentMetadata: {
          type: "tweet",
          embedHtml: oembed?.html as string | undefined,
          author,
          tweetText: ogTags.description ?? undefined,
        },
      };
    }

    case "video": {
      const videoId = extractYouTubeVideoId(url);
      const embedUrl = videoId ? `https://www.youtube.com/embed/${videoId}` : undefined;
      const oembed = await fetchOEmbed("https://www.youtube.com/oembed", url);
      return {
        ...base,
        contentType: "video",
        contentBody: null,
        contentMetadata: {
          type: "video",
          embedUrl: embedUrl ?? url,
          channel: oembed?.author_name as string | undefined,
        },
      };
    }

    case "podcast": {
      const spotifyEmbed = buildSpotifyEmbedUrl(url);
      const appleEmbed = buildApplePodcastEmbedUrl(url);
      const embedUrl = spotifyEmbed ?? appleEmbed ?? url;
      const provider = spotifyEmbed ? "spotify" as const : "apple" as const;
      return {
        ...base,
        contentType: "podcast",
        contentBody: null,
        contentMetadata: {
          type: "podcast",
          embedUrl,
          provider,
          episodeName: ogTags.title ?? undefined,
        },
      };
    }

    case "article": {
      const article = extractArticle(html, url);
      const body = article?.content ?? null;
      // Truncate at 500KB
      const truncatedBody = body && body.length > 500_000 ? body.slice(0, 500_000) : body;
      return {
        ...base,
        contentType: "article",
        contentBody: truncatedBody,
        contentMetadata: {
          type: "article",
          wordCount: article?.wordCount,
        },
      };
    }

    default: {
      // web_page — try article extraction if OG type is "article"
      let articleBody: string | null = null;
      let effectiveType: ContentType = "web_page";

      if (ogTags.ogType === "article") {
        const article = extractArticle(html, url);
        if (article) {
          articleBody = article.content.length > 500_000
            ? article.content.slice(0, 500_000)
            : article.content;
          effectiveType = "article";
        }
      }

      return {
        ...base,
        contentType: effectiveType,
        contentBody: articleBody,
        contentMetadata: effectiveType === "article"
          ? { type: "article" }
          : { type: "web_page" },
      };
    }
  }
}

/**
 * Fire-and-forget content extraction.
 * Called after creating a content item. Updates the item in DB and publishes SSE.
 */
export async function runExtraction(itemId: string, url: string, userId: string): Promise<void> {
  try {
    const result = await extractContent(url);

    // For URL-based PDFs, download the file and store as attachment
    if (result.needsPdfDownload) {
      try {
        const pdfResponse = await safeFetch(url, { timeoutMs: 60_000, maxSizeBytes: 50 * 1024 * 1024 });
        const buffer = Buffer.from(await readBinaryWithLimit(pdfResponse, 50 * 1024 * 1024));
        const rawFilename = new URL(url).pathname.split("/").pop() || "document.pdf";
        const filename = sanitizeFilename(rawFilename);
        // Upload to S3 via the storage module (same as attachment system)
        const { uploadToStorage } = await import("./storage.js");
        const storageKey = `attachments/${userId}/${itemId}/${crypto.randomUUID()}-${filename}`;
        await uploadToStorage(storageKey, buffer, "application/pdf");
        await prisma.attachment.create({
          data: { itemId, userId, filename, mimeType: "application/pdf", sizeBytes: buffer.length, storageKey },
        });
      } catch (pdfErr) {
        console.error(`[content-extractor] PDF download failed for ${url}:`, pdfErr);
        // Continue with extraction — PDF preview will fall back to external URL
      }
    }

    // Preserve source for scout-created items (source === "scout" + sourceId links back to the scout)
    const existingItem = await prisma.item.findUnique({ where: { id: itemId }, select: { source: true } });
    const preserveSource = existingItem?.source === "scout";

    const updateData: Record<string, unknown> = {
      contentType: result.contentType,
      contentStatus: result.contentStatus,
      contentTitle: result.contentTitle,
      contentDescription: result.contentDescription,
      contentImageUrl: result.contentImageUrl,
      contentBody: result.contentBody,
      contentFavicon: result.contentFavicon,
      contentDomain: result.contentDomain,
      contentMetadata: result.contentMetadata,
      ...(preserveSource ? {} : { source: result.contentDomain }),
    };

    // Update title from extraction if the current title is a placeholder
    // (raw URL, or auto-generated "Saved X from Y" from the create skill)
    if (result.title) {
      const current = await prisma.item.findUnique({ where: { id: itemId }, select: { title: true, sourceUrl: true } });
      if (current) {
        const isUrl = current.title === current.sourceUrl;
        const isPlaceholder = /^Saved \w+ from /.test(current.title);
        if (isUrl || isPlaceholder) {
          updateData.title = result.title;
        }
      }
    }

    await prisma.item.update({
      where: { id: itemId },
      data: updateData,
    });

    // Re-embed with extracted content (title, description, body may have changed)
    enqueueEmbed({ entityType: "item", entityId: itemId, userId });

    publishSSE(userId, {
      type: "content.extracted",
      payload: { itemId, contentStatus: "extracted" },
    });
  } catch (error) {
    console.error(`[content-extractor] Failed to extract ${url}:`, error);

    // Check if this was a DNS/connection failure — auto-convert to task
    // Note: only match true unreachability (ENOTFOUND, ECONNREFUSED, SSRF block).
    // SSL errors and other fetch failures indicate the server exists — mark as failed, not converted.
    const causeCode = (error instanceof Error && (error as any).cause instanceof Error)
      ? ((error as any).cause as NodeJS.ErrnoException).code ?? ""
      : "";
    const isDnsOrConnectionError = error instanceof Error &&
      (error.message.includes("ENOTFOUND") || error.message.includes("Blocked") ||
       error.message.includes("ECONNREFUSED") ||
       causeCode === "ENOTFOUND" || causeCode === "ECONNREFUSED");

    if (isDnsOrConnectionError) {
      // URL is not reachable — convert to task
      await prisma.item.update({
        where: { id: itemId },
        data: { type: "task", contentStatus: null, contentType: null, source: "Brett" },
      });
      publishSSE(userId, {
        type: "content.extracted",
        payload: { itemId, contentStatus: "converted_to_task" },
      });
    } else {
      await prisma.item.update({
        where: { id: itemId },
        data: { contentStatus: "failed" },
      });
      publishSSE(userId, {
        type: "content.extracted",
        payload: { itemId, contentStatus: "failed" },
      });
    }
  }
}
