import React, { useEffect, useRef } from "react";

interface ConfirmDialogProps {
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "danger" | "default";
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "default",
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onCancel();
      } else if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        onConfirm();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onConfirm, onCancel]);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onCancel}
        style={{
          animation: "confirmBackdropIn 150ms ease-out forwards",
        }}
      />

      {/* Dialog */}
      <div
        ref={dialogRef}
        tabIndex={0}
        className="relative z-10 w-80 bg-black/80 backdrop-blur-2xl rounded-xl border border-white/15 shadow-2xl outline-none overflow-hidden"
        style={{
          animation: "confirmDialogIn 200ms cubic-bezier(0.16, 1, 0.3, 1) forwards",
        }}
      >
        <div className="px-5 pt-5 pb-4">
          <h3 className="text-sm font-semibold text-white mb-1.5">{title}</h3>
          <p className="text-sm text-white/50 leading-relaxed">{description}</p>
        </div>

        <div className="flex items-center gap-2 px-5 pb-4">
          <button
            onClick={onCancel}
            className="flex-1 px-3 py-2 rounded-lg text-sm font-medium text-white/60 hover:text-white hover:bg-white/10 transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
              variant === "danger"
                ? "bg-red-500/20 text-red-400 hover:bg-red-500/30 hover:text-red-300 border border-red-500/20"
                : "bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 hover:text-blue-300 border border-blue-500/20"
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>

      <style>{`
        @keyframes confirmBackdropIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes confirmDialogIn {
          from {
            opacity: 0;
            transform: scale(0.95);
          }
          to {
            opacity: 1;
            transform: scale(1);
          }
        }
      `}</style>
    </div>
  );
}
