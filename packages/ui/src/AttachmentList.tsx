import React, { useState, useRef, useCallback } from "react";
import { Paperclip, Image, FileText, Film, Music, X, Loader2, AlertCircle } from "lucide-react";
import type { Attachment } from "@brett/types";

const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB

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
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const validateAndUpload = useCallback(
    (file: File) => {
      setError(null);
      if (file.size > MAX_FILE_SIZE) {
        setError(`"${file.name}" is too large (${formatFileSize(file.size)}). Max is 25 MB.`);
        return;
      }
      onUpload(file);
    },
    [onUpload],
  );

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
      Array.from(e.dataTransfer.files).forEach(validateAndUpload);
    },
    [validateAndUpload],
  );

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      Array.from(e.target.files ?? []).forEach(validateAndUpload);
      e.target.value = "";
    },
    [validateAndUpload],
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

      {/* Error message */}
      {error && (
        <div className="flex items-center gap-2 px-3 py-2 mb-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs">
          <AlertCircle size={14} className="flex-shrink-0" />
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)} className="text-red-400/60 hover:text-red-400">
            <X size={12} />
          </button>
        </div>
      )}

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
                  className="w-10 h-10 rounded object-cover flex-shrink-0 cursor-pointer hover:opacity-80 transition-opacity"
                  onClick={() => setPreviewUrl(att.url)}
                />
              ) : (
                <a
                  href={att.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-10 h-10 rounded bg-white/5 hover:bg-white/10 flex items-center justify-center flex-shrink-0 transition-colors"
                >
                  {getMimeIcon(att.mimeType)}
                </a>
              )}
              <div className="flex-1 min-w-0">
                {isImageMime(att.mimeType) ? (
                  <button
                    onClick={() => setPreviewUrl(att.url)}
                    className="text-sm text-white/80 hover:text-white truncate block transition-colors text-left"
                  >
                    {att.filename}
                  </button>
                ) : (
                  <a
                    href={att.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-white/80 hover:text-white truncate block transition-colors"
                  >
                    {att.filename}
                  </a>
                )}
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

      {/* Fullscreen image preview */}
      {previewUrl && (
        <div
          className="fixed inset-0 z-[100] bg-black/90 backdrop-blur-md flex items-center justify-center cursor-pointer"
          onClick={() => setPreviewUrl(null)}
        >
          <img
            src={previewUrl}
            alt="Preview"
            className="max-w-[calc(100vw-4rem)] max-h-[calc(100vh-4rem)] object-contain"
            onClick={(e) => e.stopPropagation()}
          />
          <button
            onClick={() => setPreviewUrl(null)}
            className="absolute top-4 right-4 p-2 bg-white/10 hover:bg-white/20 rounded-full text-white/80 hover:text-white transition-colors"
          >
            <X size={20} />
          </button>
        </div>
      )}
    </div>
  );
}
