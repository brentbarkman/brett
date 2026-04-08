import React, { useMemo } from "react";
import DOMPurify from "dompurify";
import { AlertTriangle, ExternalLink, FileText, RefreshCw } from "lucide-react";
import type { ContentType, ContentStatus, ContentMetadata } from "@brett/types";

// Dedicated DOMPurify instances to avoid global hook race conditions under React concurrent rendering.
// Each instance gets its hooks configured once at module level.
const tweetPurify = DOMPurify();
const articlePurify = DOMPurify();
const newsletterPurify = DOMPurify();

// Force all links to open in new tab (critical in Electron — prevents navigating the app window)
for (const instance of [tweetPurify, articlePurify, newsletterPurify]) {
  instance.addHook("afterSanitizeAttributes", (node: Element) => {
    if (node.tagName === "A") {
      node.setAttribute("target", "_blank");
      node.setAttribute("rel", "noopener noreferrer");
    }
  });
}

function isSafeHref(url?: string): boolean {
  if (!url) return false;
  try { return ["http:", "https:"].includes(new URL(url).protocol); }
  catch { return false; }
}

const TRUSTED_VIDEO_ORIGINS = ["https://www.youtube.com/embed/", "https://youtube.com/embed/"];
const TRUSTED_PODCAST_ORIGINS = ["https://open.spotify.com/embed/", "https://embed.podcasts.apple.com/"];

interface ContentPreviewProps {
  contentType?: ContentType;
  contentStatus?: ContentStatus;
  sourceUrl?: string;
  contentTitle?: string;
  contentDescription?: string;
  contentImageUrl?: string;
  contentBody?: string;
  contentFavicon?: string;
  contentDomain?: string;
  contentMetadata?: ContentMetadata;
  attachmentUrl?: string; // presigned S3 URL for drag-dropped PDFs
  onRetry?: () => void;
  assistantName?: string;
}

function LoadingSkeleton({ contentType }: { contentType?: ContentType }) {
  if (contentType === "video") {
    return (
      <div className="space-y-3">
        {/* 16:9 video placeholder */}
        <div className="w-full aspect-video bg-white/5 animate-pulse rounded-lg" />
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded-full bg-white/5 animate-pulse" />
          <div className="h-3 w-32 bg-white/5 animate-pulse rounded" />
        </div>
        <span className="text-xs text-white/30">Extracting content...</span>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="h-4 w-3/4 bg-white/5 animate-pulse rounded" />
      <div className="h-3 w-full bg-white/5 animate-pulse rounded" />
      <div className="h-3 w-5/6 bg-white/5 animate-pulse rounded" />
      <div className="h-3 w-2/3 bg-white/5 animate-pulse rounded" />
      <span className="text-xs text-white/30">Extracting content...</span>
    </div>
  );
}

function ErrorState({ sourceUrl, onRetry, assistantName = "Brett" }: { sourceUrl?: string; onRetry?: () => void; assistantName?: string }) {
  return (
    <div className="bg-white/5 border border-white/10 rounded-lg p-4 space-y-3">
      <div className="flex items-center gap-2">
        <AlertTriangle size={16} className="text-amber-400/70" />
        <span className="text-sm text-white/50 font-medium">Preview unavailable</span>
      </div>
      {sourceUrl && isSafeHref(sourceUrl) && (
        <a
          href={sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-brett-gold/70 hover:text-brett-gold transition-colors truncate block"
        >
          Open original →
        </a>
      )}
      <div className="flex items-center gap-2">
        {onRetry && (
          <button
            onClick={onRetry}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-white/5 text-white/60 border border-white/10 hover:bg-white/10 hover:text-white transition-colors"
          >
            <RefreshCw size={12} />
            Try again
          </button>
        )}
        <span className="text-[10px] text-white/20">
          If this persists, ask {assistantName} to report it.
        </span>
      </div>
    </div>
  );
}

function TweetPreview({ metadata, sourceUrl }: { metadata?: ContentMetadata; sourceUrl?: string }) {
  const author = metadata?.type === "tweet" ? metadata.author : undefined;
  const text = metadata?.type === "tweet" ? metadata.tweetText : undefined;
  const embedHtml = metadata?.type === "tweet" ? metadata.embedHtml : undefined;

  // The oEmbed HTML is a <blockquote> with the tweet text + a <script> tag.
  // Sanitize to keep just the blockquote content (strips the script tag).
  const sanitizedEmbed = (() => {
    if (!embedHtml) return undefined;
    return tweetPurify.sanitize(embedHtml, {
      ALLOWED_TAGS: ["blockquote", "p", "a", "br", "em", "strong", "span"],
      ALLOWED_ATTR: ["href", "dir", "lang", "target", "rel"],
      ALLOW_DATA_ATTR: false,
    });
  })();

  // If we have neither oEmbed HTML nor OG text, nothing to show
  if (!sanitizedEmbed && !text) {
    return (
      <div className="bg-white/5 rounded-lg border border-white/10 p-4 space-y-2">
        {author && <span className="text-xs text-white/60 font-medium">@{author}</span>}
        <p className="text-sm text-white/40 italic">Tweet content unavailable</p>
        {sourceUrl && isSafeHref(sourceUrl) && (
          <a href={sourceUrl} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-brett-gold hover:text-brett-gold/80 transition-colors">
            View on X <ExternalLink size={10} />
          </a>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        {author && <span className="text-xs text-white/60 font-medium">@{author}</span>}
        {sourceUrl && isSafeHref(sourceUrl) && (
          <a href={sourceUrl} target="_blank" rel="noopener noreferrer"
            className="ml-auto inline-flex items-center gap-1 text-xs text-white/40 hover:text-white/60 transition-colors">
            View on X <ExternalLink size={10} />
          </a>
        )}
      </div>
      <div className="bg-white/5 rounded-lg border border-white/10 p-4">
        {sanitizedEmbed ? (
          <div
            className="text-sm text-white/80 leading-relaxed [&_blockquote]:border-l-2 [&_blockquote]:border-white/20 [&_blockquote]:pl-3 [&_a]:text-brett-gold [&_a]:underline [&_a]:underline-offset-2 [&_a:hover]:text-brett-gold/80"
            dangerouslySetInnerHTML={{ __html: sanitizedEmbed }}
          />
        ) : (
          <p className="text-sm text-white/80 leading-relaxed italic">{text}</p>
        )}
      </div>
    </div>
  );
}

function VideoPreview({ metadata, sourceUrl }: { metadata?: ContentMetadata; sourceUrl?: string }) {
  const embedUrl = metadata?.type === "video" ? metadata.embedUrl : undefined;
  if (!embedUrl || !TRUSTED_VIDEO_ORIGINS.some(o => embedUrl.startsWith(o))) return null;

  // Set origin param so YouTube restricts postMessage to our origin
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const srcWithOrigin = `${embedUrl}${embedUrl.includes("?") ? "&" : "?"}origin=${encodeURIComponent(origin)}`;

  return (
    <div className="space-y-1.5">
      {sourceUrl && isSafeHref(sourceUrl) && (
        <a href={sourceUrl} target="_blank" rel="noopener noreferrer"
          className="text-xs text-white/40 hover:text-white/60 inline-flex items-center gap-1 transition-colors">
          Source <ExternalLink size={10} />
        </a>
      )}
      <div className="w-full aspect-video rounded-lg overflow-hidden border border-white/10">
        <iframe
          src={srcWithOrigin}
          sandbox="allow-scripts allow-same-origin allow-popups"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          title="Video player"
          className="w-full h-full"
        />
      </div>
    </div>
  );
}

function PodcastPreview({ metadata, sourceUrl }: { metadata?: ContentMetadata; sourceUrl?: string }) {
  const embedUrl = metadata?.type === "podcast" ? metadata.embedUrl : undefined;

  if (embedUrl && TRUSTED_PODCAST_ORIGINS.some(o => embedUrl.startsWith(o))) {
    const isSpotify = embedUrl.includes("spotify.com");
    return (
      <div className="space-y-1.5">
        {sourceUrl && isSafeHref(sourceUrl) && (
          <a href={sourceUrl} target="_blank" rel="noopener noreferrer"
            className="text-xs text-white/40 hover:text-white/60 inline-flex items-center gap-1 transition-colors">
            {isSpotify ? "Open in Spotify" : "Source"} <ExternalLink size={10} />
          </a>
        )}
        <div className="rounded-lg overflow-hidden border border-white/10">
          <iframe
            src={embedUrl}
            sandbox="allow-scripts allow-same-origin allow-popups"
            allow="autoplay; clipboard-write; encrypted-media"
            title="Podcast player"
            className="w-full h-[152px]"
          />
        </div>
      </div>
    );
  }

  // Fallback — untrusted embed or no embed URL
  const episodeName = metadata?.type === "podcast" ? metadata.episodeName : undefined;
  const showName = metadata?.type === "podcast" ? metadata.showName : undefined;

  return (
    <div className="bg-white/5 rounded-lg border border-white/10 p-4 space-y-2">
      {showName && <span className="text-[10px] uppercase tracking-[0.15em] font-semibold text-white/40">{showName}</span>}
      {episodeName && <p className="text-sm text-white/80">{episodeName}</p>}
      {sourceUrl && isSafeHref(sourceUrl) && (
        <a
          href={sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-amber-400 hover:text-amber-300 transition-colors"
        >
          Open in app <ExternalLink size={10} />
        </a>
      )}
    </div>
  );
}

function sanitizeArticleBody(html: string): string {
  // Strip dead interactive elements (video play buttons, watchlist dropdowns, etc.)
  // that Readability extracts as plain text from JS-driven sites like CNBC
  const cleaned = html
    .replace(/<div[^>]*data-test="PlayButton"[^>]*>[\s\S]*?<\/div>/gi, "")
    .replace(/<span[^>]*id="[^"]*WatchlistDropdown[^"]*"[^>]*>[\s\S]*?<\/span>/gi, "");

  // Uses dedicated articlePurify instance (hooks configured at module level) to avoid
  // global hook race conditions under React concurrent rendering.
  // No video/source tags — Readability strips media players, so these serve no purpose.
  // No class attribute — article styling comes from parent descendant selectors, not inline classes
  // that could apply Tailwind utilities (e.g. fixed/hidden) to disrupt layout.
  // ACCEPTED RISK: <img> tags can load from any HTTPS origin (tracking pixels). Cannot restrict
  // img-src CSP without breaking favicons/OG images. Mitigated: Electron sends no cookies to
  // third-party origins, so tracking is limited to IP/timing.
  return articlePurify.sanitize(cleaned, {
    ALLOWED_TAGS: ["h1", "h2", "h3", "h4", "h5", "h6", "p", "a", "img", "ul", "ol", "li",
      "blockquote", "pre", "code", "em", "strong", "br", "hr", "figure", "figcaption", "b", "i"],
    ALLOWED_ATTR: ["href", "src", "alt", "title", "target", "rel"],
    ALLOW_DATA_ATTR: false,
    FORBID_TAGS: ["form", "input", "button", "textarea", "select", "script", "style", "iframe", "object", "embed", "video", "source"],
    FORBID_ATTR: ["style", "class", "onerror", "onload", "onclick", "onmouseover"],
  });
}

function ArticlePreview({
  contentBody,
  contentFavicon,
  contentDomain,
  sourceUrl,
}: {
  contentBody?: string;
  contentFavicon?: string;
  contentDomain?: string;
  sourceUrl?: string;
}) {
  return (
    <div className="space-y-3">
      {/* Source bar */}
      <div className="flex items-center gap-2">
        {contentFavicon && (
          <img src={contentFavicon} alt="" className="w-4 h-4 rounded-sm" />
        )}
        {contentDomain && (
          <span className="text-xs text-white/40">{contentDomain}</span>
        )}
        {sourceUrl && isSafeHref(sourceUrl) && (
          <a
            href={sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto inline-flex items-center gap-1 text-xs text-white/40 hover:text-white/60 transition-colors"
          >
            Open original <ExternalLink size={10} />
          </a>
        )}
      </div>

      {/* Sanitized article HTML */}
      {contentBody && (
        <div
          className="max-h-[50vh] overflow-y-auto scrollbar-hide text-sm text-white/80 leading-relaxed [&_p]:mb-4 [&_p:last-child]:mb-0 [&_h1]:text-lg [&_h1]:font-bold [&_h1]:mb-3 [&_h1]:mt-5 [&_h2]:text-base [&_h2]:font-bold [&_h2]:mb-2 [&_h2]:mt-4 [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:mb-2 [&_h3]:mt-3 [&_blockquote]:border-l-2 [&_blockquote]:border-white/20 [&_blockquote]:pl-3 [&_blockquote]:my-3 [&_blockquote]:text-white/60 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:mb-3 [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:mb-3 [&_li]:mb-1 [&_a]:text-brett-gold [&_a]:underline [&_a]:underline-offset-2 [&_pre]:bg-white/5 [&_pre]:rounded [&_pre]:p-3 [&_pre]:my-3 [&_pre]:overflow-x-auto [&_code]:text-xs [&_hr]:border-white/10 [&_hr]:my-4 [&_img]:rounded [&_img]:my-3"
          dangerouslySetInnerHTML={{ __html: sanitizeArticleBody(contentBody) }}
        />
      )}
    </div>
  );
}

function PdfPreview({ sourceUrl, attachmentUrl }: { sourceUrl?: string; attachmentUrl?: string }) {
  // Prefer presigned S3 URL (drag-dropped PDFs), fall back to source URL.
  // CSP frame-src is the real enforcement boundary for which origins can be iframed.
  const pdfUrl = attachmentUrl ?? sourceUrl;
  if (!pdfUrl) return null;
  try {
    const u = new URL(pdfUrl);
    if (u.protocol !== "https:") return null;
  } catch { return null; }

  return (
    <div className="w-full aspect-[3/4] rounded-lg overflow-hidden border border-white/10">
      <iframe src={pdfUrl} sandbox="allow-same-origin" title="PDF viewer" className="w-full h-full" />
    </div>
  );
}

function WebPagePreview({
  contentTitle,
  contentDescription,
  contentImageUrl,
  contentFavicon,
  contentDomain,
  sourceUrl,
}: {
  contentTitle?: string;
  contentDescription?: string;
  contentImageUrl?: string;
  contentFavicon?: string;
  contentDomain?: string;
  sourceUrl?: string;
}) {
  const safeHref = isSafeHref(sourceUrl) ? sourceUrl : undefined;

  return (
    <a
      href={safeHref}
      target="_blank"
      rel="noopener noreferrer"
      className="block bg-white/5 rounded-lg border border-white/10 overflow-hidden hover:bg-white/10 transition-colors group"
    >
      {contentImageUrl && (
        <img
          src={contentImageUrl}
          alt=""
          className="w-full h-40 object-cover"
        />
      )}
      <div className="p-4 space-y-2">
        {contentTitle ? (
          <h4 className="text-sm font-medium text-white/90 group-hover:text-white transition-colors">
            {contentTitle}
          </h4>
        ) : (
          <h4 className="text-sm font-medium text-white/60 group-hover:text-white/80 transition-colors">
            Open in browser
          </h4>
        )}
        {contentDescription && (
          <p className="text-xs text-white/60 line-clamp-2">{contentDescription}</p>
        )}
        {!contentTitle && !contentDescription && sourceUrl && (
          <p className="text-xs text-white/40 truncate">{sourceUrl}</p>
        )}
        <div className="flex items-center gap-2">
          {contentFavicon && (
            <img src={contentFavicon} alt="" className="w-3.5 h-3.5 rounded-sm" />
          )}
          {contentDomain && (
            <span className="text-xs text-white/40">{contentDomain}</span>
          )}
          <ExternalLink size={10} className="text-white/30 ml-auto" />
        </div>
      </div>
    </a>
  );
}

function NewsletterPreview({
  contentBody,
  contentMetadata,
}: {
  contentBody?: string;
  contentMetadata?: ContentMetadata;
}) {
  const senderName = contentMetadata?.type === "newsletter" ? contentMetadata.senderName : undefined;
  const receivedAt = contentMetadata?.type === "newsletter" ? contentMetadata.receivedAt : undefined;

  const iframeContent = useMemo(() => {
    if (!contentBody) return "";
    const sanitized = newsletterPurify.sanitize(contentBody, {
      ALLOWED_TAGS: [
        "div", "span", "p", "br", "hr",
        "h1", "h2", "h3", "h4", "h5", "h6",
        "strong", "b", "em", "i", "u", "s", "sub", "sup",
        "ul", "ol", "li",
        "a", "img",
        "table", "thead", "tbody", "tr", "td", "th",
        "blockquote", "pre", "code",
      ],
      ALLOWED_ATTR: [
        "href", "src", "alt", "title", "width", "height",
        "style", "class", "id",
        "target", "rel",
        "colspan", "rowspan", "cellpadding", "cellspacing",
      ],
      FORBID_TAGS: ["script", "iframe", "object", "embed", "form", "input", "button", "textarea", "select", "style"],
      FORBID_ATTR: ["onerror", "onload", "onclick", "onmouseover"],
      ALLOW_DATA_ATTR: false,
    });

    return `<!DOCTYPE html>
<html><head><style>
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    font-size: 14px;
    line-height: 1.6;
    color: rgba(255,255,255,0.85);
    background: transparent;
    max-width: 680px;
    margin: 0 auto;
    padding: 0;
    overflow-x: hidden;
  }
  a { color: #D4AF37; }
  img { max-width: 100%; height: auto; }
  table { max-width: 100%; }
</style></head><body>${sanitized}</body></html>`;
  }, [contentBody]);

  return (
    <div className="space-y-2">
      {(senderName || receivedAt) && (
        <div className="flex items-center gap-2">
          {senderName && (
            <span className="text-xs text-white/50 font-medium">{senderName}</span>
          )}
          {receivedAt && (
            <span className="text-xs text-white/30">
              {new Date(receivedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
            </span>
          )}
        </div>
      )}

      {contentBody ? (
        // SECURITY INVARIANT: NEVER add allow-scripts to this sandbox.
        // allow-same-origin + allow-scripts would give newsletter HTML
        // full access to the Electron renderer process.
        <iframe
          sandbox="allow-same-origin"
          srcDoc={iframeContent}
          title="Newsletter content"
          className="w-full min-h-[300px] max-h-[60vh] rounded-lg border border-white/10 bg-transparent"
          style={{ colorScheme: "dark" }}
        />
      ) : (
        <p className="text-sm text-white/40 italic">Newsletter content unavailable</p>
      )}
    </div>
  );
}

export function ContentPreview({
  contentType,
  contentStatus,
  sourceUrl,
  contentTitle,
  contentDescription,
  contentImageUrl,
  contentBody,
  contentFavicon,
  contentDomain,
  contentMetadata,
  attachmentUrl,
  onRetry,
  assistantName = "Brett",
}: ContentPreviewProps) {
  // Loading state
  if (contentStatus === "pending") {
    return <LoadingSkeleton contentType={contentType} />;
  }

  // Error state
  if (contentStatus === "failed") {
    return <ErrorState sourceUrl={sourceUrl} onRetry={onRetry} assistantName={assistantName} />;
  }

  // Render based on content type
  switch (contentType) {
    case "tweet":
      return <TweetPreview metadata={contentMetadata} sourceUrl={sourceUrl} />;
    case "video":
      return <VideoPreview metadata={contentMetadata} sourceUrl={sourceUrl} />;
    case "podcast":
      return <PodcastPreview metadata={contentMetadata} sourceUrl={sourceUrl} />;
    case "article":
      // Fall back to web_page card if no article body was extracted
      if (!contentBody) {
        return (
          <WebPagePreview
            contentTitle={contentTitle}
            contentDescription={contentDescription}
            contentImageUrl={contentImageUrl}
            contentFavicon={contentFavicon}
            contentDomain={contentDomain}
            sourceUrl={sourceUrl}
          />
        );
      }
      return (
        <ArticlePreview
          contentBody={contentBody}
          contentFavicon={contentFavicon}
          contentDomain={contentDomain}
          sourceUrl={sourceUrl}
        />
      );
    case "pdf":
      return <PdfPreview sourceUrl={sourceUrl} attachmentUrl={attachmentUrl} />;
    case "newsletter":
      return <NewsletterPreview contentBody={contentBody} contentMetadata={contentMetadata} />;
    case "web_page":
    default:
      return (
        <WebPagePreview
          contentTitle={contentTitle}
          contentDescription={contentDescription}
          contentImageUrl={contentImageUrl}
          contentFavicon={contentFavicon}
          contentDomain={contentDomain}
          sourceUrl={sourceUrl}
        />
      );
  }
}
