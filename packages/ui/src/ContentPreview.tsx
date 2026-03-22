import React from "react";
import DOMPurify from "dompurify";
import { AlertTriangle, ExternalLink, FileText, RefreshCw } from "lucide-react";
import type { ContentType, ContentStatus, ContentMetadata } from "@brett/types";

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
      {sourceUrl && (
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
  if (metadata?.type === "tweet" && metadata.embedHtml) {
    return (
      <iframe
        srcDoc={`<!DOCTYPE html><html><head><style>body{margin:0;background:transparent;color:#fff;font-family:system-ui;}</style></head><body>${metadata.embedHtml}</body></html>`}
        sandbox="allow-scripts allow-popups"
        className="w-full min-h-[200px] rounded-lg border border-white/10"
        style={{ colorScheme: "dark" }}
      />
    );
  }

  // Fallback: blockquote card
  const author = metadata?.type === "tweet" ? metadata.author : undefined;
  const text = metadata?.type === "tweet" ? metadata.tweetText : undefined;

  return (
    <div className="bg-white/5 rounded-lg border border-white/10 p-4 space-y-2">
      {author && <span className="text-xs text-white/60 font-medium">@{author}</span>}
      {text && <p className="text-sm text-white/80 leading-relaxed italic">{text}</p>}
      {sourceUrl && (
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

function VideoPreview({ metadata }: { metadata?: ContentMetadata }) {
  const embedUrl = metadata?.type === "video" ? metadata.embedUrl : undefined;
  if (!embedUrl) return null;

  return (
    <div className="w-full aspect-video rounded-lg overflow-hidden border border-white/10">
      <iframe
        src={embedUrl}
        sandbox="allow-scripts allow-same-origin allow-popups"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
        className="w-full h-full"
      />
    </div>
  );
}

function PodcastPreview({ metadata, sourceUrl }: { metadata?: ContentMetadata; sourceUrl?: string }) {
  if (metadata?.type === "podcast" && metadata.embedUrl) {
    return (
      <div className="rounded-lg overflow-hidden border border-white/10">
        <iframe
          src={metadata.embedUrl}
          sandbox="allow-scripts allow-same-origin allow-popups"
          className="w-full h-[152px]"
        />
      </div>
    );
  }

  // Fallback
  const episodeName = metadata?.type === "podcast" ? metadata.episodeName : undefined;
  const showName = metadata?.type === "podcast" ? metadata.showName : undefined;

  return (
    <div className="bg-white/5 rounded-lg border border-white/10 p-4 space-y-2">
      {showName && <span className="text-xs text-white/40 font-mono uppercase tracking-wider">{showName}</span>}
      {episodeName && <p className="text-sm text-white/80">{episodeName}</p>}
      {sourceUrl && (
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
        {sourceUrl && (
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
            __html: DOMPurify.sanitize(contentBody),
          }}
        />
      )}
    </div>
  );
}

function PdfPreview({ sourceUrl, attachmentUrl }: { sourceUrl?: string; attachmentUrl?: string }) {
  const pdfUrl = attachmentUrl ?? sourceUrl;
  if (!pdfUrl) return null;

  return (
    <div className="w-full aspect-[3/4] rounded-lg overflow-hidden border border-white/10">
      <iframe src={pdfUrl} className="w-full h-full" />
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
  return (
    <a
      href={sourceUrl}
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
      return <VideoPreview metadata={contentMetadata} />;
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
