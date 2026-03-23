import React from "react";
import DOMPurify from "dompurify";
import { AlertTriangle, ExternalLink, FileText, RefreshCw } from "lucide-react";
import type { ContentType, ContentStatus, ContentMetadata } from "@brett/types";

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
        <span className="text-xs text-white/30 font-mono">Extracting content...</span>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="h-4 w-3/4 bg-white/5 animate-pulse rounded" />
      <div className="h-3 w-full bg-white/5 animate-pulse rounded" />
      <div className="h-3 w-5/6 bg-white/5 animate-pulse rounded" />
      <div className="h-3 w-2/3 bg-white/5 animate-pulse rounded" />
      <span className="text-xs text-white/30 font-mono">Extracting content...</span>
    </div>
  );
}

function ErrorState({ sourceUrl, onRetry }: { sourceUrl?: string; onRetry?: () => void }) {
  return (
    <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 space-y-3">
      <div className="flex items-center gap-2">
        <AlertTriangle size={16} className="text-red-400" />
        <span className="text-sm text-red-400 font-medium">Couldn't load preview</span>
      </div>
      {sourceUrl && isSafeHref(sourceUrl) && (
        <a
          href={sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-white/40 hover:text-white/60 transition-colors truncate block"
        >
          {sourceUrl}
        </a>
      )}
      {onRetry && (
        <button
          onClick={onRetry}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-white/5 text-white/60 border border-white/10 hover:bg-white/10 hover:text-white transition-colors"
        >
          <RefreshCw size={12} />
          Retry
        </button>
      )}
    </div>
  );
}

function TweetPreview({ metadata, sourceUrl }: { metadata?: ContentMetadata; sourceUrl?: string }) {
  const author = metadata?.type === "tweet" ? metadata.author : undefined;
  const text = metadata?.type === "tweet" ? metadata.tweetText : undefined;

  return (
    <div className="bg-white/5 rounded-lg border border-white/10 p-4 space-y-2">
      {author && <span className="text-xs text-white/60 font-medium">@{author}</span>}
      {text && <p className="text-sm text-white/80 leading-relaxed italic">{text}</p>}
      {sourceUrl && isSafeHref(sourceUrl) && (
        <a
          href={sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition-colors"
        >
          View on X <ExternalLink size={10} />
        </a>
      )}
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
      <div className="w-full aspect-video rounded-lg overflow-hidden border border-white/10">
        {/* No sandbox — embedUrl is validated against TRUSTED_VIDEO_ORIGINS before rendering.
            YouTube's own embed code doesn't use sandbox. The URL allowlist is the security boundary. */}
        <iframe
          src={srcWithOrigin}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          title="Video player"
          className="w-full h-full"
        />
      </div>
      {sourceUrl && isSafeHref(sourceUrl) && (
        <a href={sourceUrl} target="_blank" rel="noopener noreferrer"
          className="text-xs text-white/40 hover:text-white/60 inline-flex items-center gap-1 transition-colors">
          Source <ExternalLink size={10} />
        </a>
      )}
    </div>
  );
}

function PodcastPreview({ metadata, sourceUrl }: { metadata?: ContentMetadata; sourceUrl?: string }) {
  const embedUrl = metadata?.type === "podcast" ? metadata.embedUrl : undefined;

  if (embedUrl && TRUSTED_PODCAST_ORIGINS.some(o => embedUrl.startsWith(o))) {
    return (
      <div className="rounded-lg overflow-hidden border border-white/10">
        {/* No sandbox — embedUrl is validated against TRUSTED_PODCAST_ORIGINS before rendering. */}
        <iframe
          src={embedUrl}
          allow="autoplay; clipboard-write; encrypted-media"
          title="Podcast player"
          className="w-full h-[152px]"
        />
      </div>
    );
  }

  // Fallback — untrusted embed or no embed URL
  const episodeName = metadata?.type === "podcast" ? metadata.episodeName : undefined;
  const showName = metadata?.type === "podcast" ? metadata.showName : undefined;

  return (
    <div className="bg-white/5 rounded-lg border border-white/10 p-4 space-y-2">
      {showName && <span className="text-xs text-white/40 font-mono uppercase tracking-wider">{showName}</span>}
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
          className="max-h-[50vh] overflow-y-auto scrollbar-hide text-sm text-white/80 leading-relaxed prose-invert prose-sm"
          dangerouslySetInnerHTML={{
            __html: DOMPurify.sanitize(contentBody, {
              ALLOWED_TAGS: ["h1", "h2", "h3", "h4", "h5", "h6", "p", "a", "img", "ul", "ol", "li",
                "blockquote", "pre", "code", "em", "strong", "br", "hr", "figure", "figcaption", "b", "i"],
              ALLOWED_ATTR: ["href", "src", "alt", "title", "class"],
              ALLOW_DATA_ATTR: false,
              FORBID_TAGS: ["form", "input", "button", "textarea", "select", "script", "style", "iframe", "object", "embed"],
              FORBID_ATTR: ["style", "onerror", "onload", "onclick", "onmouseover"],
            }),
          }}
        />
      )}
    </div>
  );
}

function PdfPreview({ sourceUrl, attachmentUrl }: { sourceUrl?: string; attachmentUrl?: string }) {
  const pdfUrl = attachmentUrl ?? sourceUrl;
  if (!pdfUrl) return null;
  // Only allow https URLs
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
        {contentTitle && (
          <h4 className="text-sm font-medium text-white/90 group-hover:text-white transition-colors">
            {contentTitle}
          </h4>
        )}
        {contentDescription && (
          <p className="text-xs text-white/60 line-clamp-2">{contentDescription}</p>
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
}: ContentPreviewProps) {
  // Loading state
  if (contentStatus === "pending") {
    return <LoadingSkeleton contentType={contentType} />;
  }

  // Error state
  if (contentStatus === "failed") {
    return <ErrorState sourceUrl={sourceUrl} onRetry={onRetry} />;
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
