import React, { useState, useEffect, useRef } from "react";
import { Calendar } from "lucide-react";

interface CalendarConnectModalProps {
  onConnect: (meetingNotes: boolean) => void;
  onCancel: () => void;
  isPending?: boolean;
}

export function CalendarConnectModal({ onConnect, onCancel, isPending }: CalendarConnectModalProps) {
  const [includeMeetingNotes, setIncludeMeetingNotes] = useState(true);
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
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onCancel}
        style={{ animation: "calConnectBackdropIn 150ms ease-out forwards" }}
      />

      {/* Dialog */}
      <div
        ref={dialogRef}
        tabIndex={0}
        className="relative z-10 w-[380px] bg-black/80 backdrop-blur-2xl rounded-xl border border-white/10 shadow-2xl outline-none overflow-hidden"
        style={{ animation: "calConnectDialogIn 200ms cubic-bezier(0.16, 1, 0.3, 1) forwards" }}
      >
        <div className="px-5 pt-5 pb-4">
          {/* Header */}
          <div className="text-center mb-5">
            <div className="w-10 h-10 rounded-lg mx-auto mb-3 flex items-center justify-center bg-white/5 border border-white/10">
              <Calendar size={20} className="text-white/60" />
            </div>
            <h3 className="text-sm font-semibold text-white">Connect your Google Calendar</h3>
            <p className="text-xs text-white/40 mt-1">Brett will sync your events and keep them up to date</p>
          </div>

          {/* Meeting notes toggle */}
          <div className="bg-white/5 border border-white/10 rounded-lg p-3.5">
            <div className="flex items-center justify-between">
              <div className="flex-1 mr-4">
                <div className="text-[13px] font-medium text-white/90">Include meeting notes</div>
                <div className="text-[11px] text-white/40 mt-1 leading-relaxed">
                  Brett reads your Meet transcripts to extract action items and build a richer picture of your work. Less note-taking, fewer dropped balls.
                </div>
              </div>
              <button
                role="switch"
                aria-checked={includeMeetingNotes}
                onClick={() => setIncludeMeetingNotes(!includeMeetingNotes)}
                className={`relative inline-flex h-[18px] w-[32px] items-center rounded-full transition-colors flex-shrink-0 ${
                  includeMeetingNotes ? "bg-brett-gold" : "bg-white/15"
                }`}
              >
                <span
                  className={`inline-block h-[14px] w-[14px] rounded-full bg-white shadow-sm transition-transform ${
                    includeMeetingNotes ? "translate-x-[16px]" : "translate-x-[2px]"
                  }`}
                />
              </button>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 px-5 pb-4">
          <button
            onClick={onCancel}
            className="flex-1 px-3 py-2 rounded-lg text-sm font-medium text-white/60 hover:text-white hover:bg-white/10 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => onConnect(includeMeetingNotes)}
            disabled={isPending}
            className="flex-1 px-3 py-2 rounded-lg text-sm font-medium bg-brett-gold/20 text-brett-gold hover:bg-brett-gold/30 border border-brett-gold/20 transition-colors disabled:opacity-40"
          >
            Continue to Google →
          </button>
        </div>
      </div>

      <style>{`
        @keyframes calConnectBackdropIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes calConnectDialogIn {
          from { opacity: 0; transform: scale(0.95); }
          to { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  );
}
