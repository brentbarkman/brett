// apps/desktop/src/components/FeedbackModal.tsx
import React, { useState, useEffect, useRef } from "react";
import { useSubmitFeedback } from "../api/feedback";
import type { DiagnosticSnapshot } from "../lib/diagnostics";

type FeedbackType = "bug" | "feature" | "enhancement";

interface FeedbackModalProps {
  isOpen: boolean;
  onClose: () => void;
  diagnostics: DiagnosticSnapshot | null;
  screenshot: string | null;
  userId: string;
}

const TYPE_OPTIONS: { value: FeedbackType; label: string }[] = [
  { value: "bug", label: "Bug" },
  { value: "feature", label: "Feature Request" },
  { value: "enhancement", label: "Enhancement" },
];

const PLACEHOLDERS: Record<FeedbackType, string> = {
  bug: "What happened? What did you expect?",
  feature: "What would you like to see?",
  enhancement: "What could be better?",
};

export function FeedbackModal({ isOpen, onClose, diagnostics, screenshot, userId }: FeedbackModalProps) {
  const [type, setType] = useState<FeedbackType>("bug");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [includeScreenshot, setIncludeScreenshot] = useState(true);
  const [includeDiagnostics, setIncludeDiagnostics] = useState(true);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [showScreenshotPreview, setShowScreenshotPreview] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);

  const submitFeedback = useSubmitFeedback();

  // Focus title on open
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => titleRef.current?.focus(), 100);
    }
  }, [isOpen]);

  // Reset state on close
  useEffect(() => {
    if (!isOpen) {
      setType("bug");
      setTitle("");
      setDescription("");
      setIncludeScreenshot(true);
      setIncludeDiagnostics(true);
      setShowDiagnostics(false);
      setShowScreenshotPreview(false);
      submitFeedback.reset();
    }
  }, [isOpen]);

  // Escape to close
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const canSubmit = title.trim().length > 0 && description.trim().length > 0 && !submitFeedback.isPending;

  const handleSubmit = () => {
    if (!canSubmit || !diagnostics) return;

    submitFeedback.mutate({
      type,
      title: title.slice(0, 200),
      description: description.slice(0, 4000),
      diagnostics: {
        ...(includeScreenshot && screenshot ? { screenshot } : {}),
        appVersion: diagnostics.appVersion,
        os: diagnostics.os,
        currentRoute: diagnostics.currentRoute,
        ...(includeDiagnostics
          ? {
              consoleErrors: diagnostics.consoleErrors,
              consoleLogs: diagnostics.consoleLogs,
              failedApiCalls: diagnostics.failedApiCalls,
              breadcrumbs: diagnostics.breadcrumbs,
            }
          : {
              consoleErrors: [],
              consoleLogs: [],
              failedApiCalls: [],
              breadcrumbs: [],
            }),
        userId,
      },
    });
  };

  // Success state
  if (submitFeedback.isSuccess) {
    const data = submitFeedback.data;
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center">
        <div className="absolute inset-0 bg-black/40" onClick={onClose} style={{ animation: "confirmBackdropIn 150ms ease-out forwards" }} />
        <div
          className="relative z-10 w-[500px] bg-black/80 backdrop-blur-2xl rounded-xl border border-white/15 shadow-2xl overflow-hidden"
          style={{ animation: "confirmDialogIn 200ms cubic-bezier(0.16, 1, 0.3, 1) forwards" }}
        >
          <div className="px-6 py-8 text-center">
            <div className="text-2xl mb-2">Submitted</div>
            <p className="text-sm text-white/50 mb-4">
              Issue #{data.issueNumber} created successfully.
            </p>
            <a
              href={data.issueUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-brett-gold hover:text-brett-gold/80 underline"
            >
              View on GitHub
            </a>
            <div className="mt-6">
              <button
                onClick={onClose}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-white/10 text-white hover:bg-white/15 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
        <style>{feedbackAnimationStyles}</style>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40" onClick={onClose} style={{ animation: "confirmBackdropIn 150ms ease-out forwards" }} />

      {/* Modal */}
      <div
        className="relative z-10 w-[600px] max-h-[80vh] bg-black/80 backdrop-blur-2xl rounded-xl border border-white/15 shadow-2xl overflow-hidden flex flex-col"
        style={{ animation: "confirmDialogIn 200ms cubic-bezier(0.16, 1, 0.3, 1) forwards" }}
      >
        {/* Header */}
        <div className="px-6 pt-5 pb-3">
          <h2 className="text-sm font-semibold text-white">Send Feedback</h2>
        </div>

        {/* Body - scrollable */}
        <div className="flex-1 overflow-y-auto px-6 pb-4 space-y-4">
          {/* Type selector */}
          <div className="flex gap-1 bg-white/5 rounded-lg p-1">
            {TYPE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setType(opt.value)}
                className={`flex-1 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  type === opt.value
                    ? "bg-white/15 text-white"
                    : "text-white/40 hover:text-white/60"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* Title */}
          <input
            ref={titleRef}
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value.slice(0, 200))}
            placeholder="Title"
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-white/20"
          />

          {/* Description */}
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value.slice(0, 4000))}
            placeholder={PLACEHOLDERS[type]}
            rows={4}
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-white/20 resize-none"
          />

          {/* Screenshot preview */}
          {screenshot && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <button
                  onClick={() => setShowScreenshotPreview(!showScreenshotPreview)}
                  className="text-xs text-white/40 hover:text-white/60"
                >
                  Screenshot {showScreenshotPreview ? "▼" : "▶"}
                </button>
                <button
                  onClick={() => setIncludeScreenshot(!includeScreenshot)}
                  className={`text-xs ${includeScreenshot ? "text-white/40 hover:text-red-400" : "text-red-400"}`}
                >
                  {includeScreenshot ? "Remove" : "Include"}
                </button>
              </div>
              {showScreenshotPreview && includeScreenshot && (
                <img
                  src={`data:image/png;base64,${screenshot}`}
                  alt="Screenshot"
                  className="w-full rounded-lg border border-white/10 opacity-80"
                />
              )}
              {!includeScreenshot && (
                <p className="text-xs text-white/30 italic">Screenshot removed from submission</p>
              )}
            </div>
          )}

          {/* Diagnostics preview */}
          {diagnostics && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <button
                  onClick={() => setShowDiagnostics(!showDiagnostics)}
                  className="text-xs text-white/40 hover:text-white/60"
                >
                  Diagnostics {showDiagnostics ? "▼" : "▶"}
                </button>
                <button
                  onClick={() => setIncludeDiagnostics(!includeDiagnostics)}
                  className={`text-xs ${includeDiagnostics ? "text-white/40 hover:text-red-400" : "text-red-400"}`}
                >
                  {includeDiagnostics ? "Remove" : "Include"}
                </button>
              </div>
              {showDiagnostics && includeDiagnostics && (
                <div className="bg-white/5 rounded-lg p-3 text-xs text-white/40 font-mono space-y-1 max-h-40 overflow-y-auto">
                  <div>App: {diagnostics.appVersion}</div>
                  <div>Route: {diagnostics.currentRoute}</div>
                  <div>Console Errors: {diagnostics.consoleErrors.length}</div>
                  <div>Console Logs: {diagnostics.consoleLogs.length}</div>
                  <div>Failed API Calls: {diagnostics.failedApiCalls.length}</div>
                  <div>Breadcrumbs: {diagnostics.breadcrumbs.length}</div>
                </div>
              )}
            </div>
          )}

          {/* Error */}
          {submitFeedback.isError && (
            <p className="text-xs text-red-400">
              {submitFeedback.error.message}
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-white/5">
          <button
            onClick={onClose}
            className="px-3 py-2 rounded-lg text-sm font-medium text-white/60 hover:text-white hover:bg-white/10 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-brett-gold/20 text-brett-gold hover:bg-brett-gold/30 border border-brett-gold/20 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {submitFeedback.isPending ? "Submitting..." : "Submit"}
          </button>
        </div>
      </div>

      <style>{feedbackAnimationStyles}</style>
    </div>
  );
}

const feedbackAnimationStyles = `
  @keyframes confirmBackdropIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }
  @keyframes confirmDialogIn {
    from { opacity: 0; transform: scale(0.95); }
    to { opacity: 1; transform: scale(1); }
  }
`;
