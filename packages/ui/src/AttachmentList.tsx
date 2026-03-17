import React, { useState, useRef, useCallback } from "react";
import { Paperclip, Image, FileText, Film, Music, X, Loader2 } from "lucide-react";
import type { Attachment } from "@brett/types";

interface AttachmentListProps {
  attachments: Attachment[];
  onUpload: (file: File) => void;
  onDelete: (attachmentId: string) => void;
  isUploading?: boolean;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getMimeIcon(mimeType: string) {
  if (mimeType.startsWith("image/")) return <Image size={16} className="text-white/40" />;
  if (mimeType.startsWith("video/")) return <Film size={16} className="text-white/40" />;
  if (mimeType.startsWith("audio/")) return <Music size={16} className="text-white/40" />;
  return <FileText size={16} className="text-white/40" />;
}

function isImageMime(mimeType: string): boolean {
  return mimeType.startsWith("image/");
}

export function AttachmentList({
  attachments,
  onUpload,
  onDelete,
  isUploading,
}: AttachmentListProps) {
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const files = Array.from(e.dataTransfer.files);
      files.forEach((file) => onUpload(file));
    },
    [onUpload],
  );

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      files.forEach((file) => onUpload(file));
      // Reset so same file can be re-selected
      e.target.value = "";
    },
    [onUpload],
  );

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <span className="font-mono text-xs uppercase tracking-wider text-white/40 font-semibold mb-2 block">
        Attachments
      </span>

      {/* Attachment cards */}
      {attachments.length > 0 && (
        <div className="space-y-2 mb-3">
          {attachments.map((att) => (
            <div
              key={att.id}
              className="group flex items-center gap-3 p-2 rounded-lg bg-white/5 border border-white/10"
            >
              {isImageMime(att.mimeType) ? (
                <img
                  src={att.url}
                  alt={att.filename}
                  className="w-10 h-10 rounded object-cover flex-shrink-0"
                />
              ) : (
                <div className="w-10 h-10 rounded bg-white/5 flex items-center justify-center flex-shrink-0">
                  {getMimeIcon(att.mimeType)}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <a
                  href={att.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-white/80 hover:text-white truncate block transition-colors"
                >
                  {att.filename}
                </a>
                <span className="text-xs text-white/40">
                  {formatFileSize(att.sizeBytes)}
                </span>
              </div>
              <button
                onClick={() => onDelete(att.id)}
                className="p-1 text-white/30 hover:text-white hover:bg-white/10 rounded-full transition-colors opacity-0 group-hover:opacity-100"
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Upload zone */}
      <button
        onClick={() => fileInputRef.current?.click()}
        className={`w-full flex items-center justify-center gap-2 p-3 rounded-lg border border-dashed transition-colors text-xs ${
          isDragging
            ? "border-blue-500/50 bg-blue-500/10 text-blue-400"
            : "border-white/10 bg-white/5 text-white/40 hover:bg-white/10 hover:text-white/60"
        }`}
      >
        {isUploading ? (
          <Loader2 size={14} className="animate-spin" />
        ) : (
          <Paperclip size={14} />
        )}
        {isUploading ? "Uploading\u2026" : "Drop files or click to attach"}
      </button>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        onChange={handleFileChange}
        className="hidden"
      />
    </div>
  );
}
