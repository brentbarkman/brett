import React, { useState, useCallback, useRef } from "react";
import { FileText } from "lucide-react";

interface AppDropZoneProps {
  children: React.ReactNode;
  onDropPdf: (file: File) => void;
}

export function cleanFilename(filename: string): string {
  return filename
    .replace(/\.pdf$/i, "")
    .replace(/[-_]+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function AppDropZone({ children, onDropPdf }: AppDropZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const dragCountRef = useRef(0);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCountRef.current++;

    // Only show overlay if dragging files that include a PDF
    if (e.dataTransfer.types.includes("Files")) {
      setIsDragging(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCountRef.current--;
    if (dragCountRef.current === 0) {
      setIsDragging(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCountRef.current = 0;
      setIsDragging(false);

      const files = Array.from(e.dataTransfer.files);
      const pdfFile = files.find(
        (f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"),
      );

      if (pdfFile) {
        onDropPdf(pdfFile);
      }
    },
    [onDropPdf],
  );

  return (
    <div
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      className="relative w-full h-full"
    >
      {children}

      {/* Full-window overlay */}
      {isDragging && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm pointer-events-none">
          <div className="flex flex-col items-center gap-4 p-8 rounded-2xl border-2 border-dashed border-amber-500/50 bg-amber-500/10">
            <FileText size={48} className="text-amber-400" />
            <span className="text-sm font-medium text-amber-400">
              Drop PDF to save
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
