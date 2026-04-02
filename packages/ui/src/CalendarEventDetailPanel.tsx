import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  MapPin,
  Video,
  RefreshCw,
  Check,
  HelpCircle,
  X,
  User,
  Paperclip,
  FileText,
  ExternalLink,
} from "lucide-react";
import { SimpleMarkdown } from "./SimpleMarkdown";
import type {
  CalendarEventDetailResponse,
  CalendarRsvpStatus,
  CalendarAttendee,
} from "@brett/types";
import DOMPurify from "dompurify";
import { isSafeUrl } from "@brett/utils";
import { RichTextEditor } from "./RichTextEditor";
import { BrettThread } from "./BrettThread";
import type { BrettThreadMessage } from "./BrettThread";

/** Attendee avatar — uses stored photo URL from People API, falls back to initials */
function AttendeeAvatar({ photoUrl, name }: { photoUrl?: string | null; name: string }) {
  const [imgError, setImgError] = useState(false);
  const initials = name.split(" ").map((n: string) => n[0]).join("").slice(0, 2).toUpperCase();

  if (!photoUrl || imgError) {
    return (
      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center text-xs font-bold text-white shadow-inner flex-shrink-0">
        {initials}
      </div>
    );
  }

  return (
    <img
      src={photoUrl}
      alt={name}
      onError={() => setImgError(true)}
      className="w-8 h-8 rounded-full object-cover flex-shrink-0"
      referrerPolicy="no-referrer"
    />
  );
}

interface CalendarEventDetailPanelProps {
  detail: CalendarEventDetailResponse;
  onClose: () => void;
  onUpdateRsvp: (status: CalendarRsvpStatus, comment?: string) => void;
  onUpdateNotes: (content: string) => void;
  brettMessages: BrettThreadMessage[];
  brettTotalCount: number;
  brettHasMore: boolean;
  onSendBrettMessage: (content: string) => void;
  onLoadMoreBrettMessages: () => void;
  isSendingBrettMessage: boolean;
  isBrettStreaming?: boolean;
  isLoadingMoreBrettMessages: boolean;
  brettAiConfigured?: boolean;
  onOpenSettings?: () => void;
  meetingNote?: {
    id: string;
    title: string;
    summary: string | null;
    transcript: { source: string; speaker: string; text: string }[] | null;
    actionItems: { title: string; dueDate?: string; assignee?: string; assigneeName?: string }[] | null;
    items?: { id: string; title: string; status: string; dueDate: string | null }[];
    meetingStartedAt: string;
  } | null;
  onToggleActionItem?: (itemId: string) => void;
  onSelectActionItem?: (itemId: string) => void;
  onReprocessActionItems?: (meetingId: string) => void;
  isReprocessing?: boolean;
  onItemClick?: (id: string) => void;
  onEventClick?: (eventId: string) => void;
  onNavigate?: (path: string) => void;
}

function formatEventTime(start: string, end: string, isAllDay: boolean): string {
  if (isAllDay) return "All day";
  const startDate = new Date(start);
  const endDate = new Date(end);
  const dateStr = startDate.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const startTime = startDate.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
  const endTime = endDate.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${dateStr}, ${startTime} – ${endTime}`;
}

function ResponseStatusIcon({ status }: { status?: string }) {
  switch (status) {
    case "accepted":
      return <Check size={12} className="text-green-400" />;
    case "tentative":
      return <HelpCircle size={12} className="text-yellow-400" />;
    case "declined":
      return <X size={12} className="text-red-400" />;
    default:
      return <span className="text-white/30 text-xs">—</span>;
  }
}

function AttachmentIcon({ mimeType }: { mimeType?: string }) {
  if (!mimeType) return <Paperclip size={14} className="text-white/40" />;
  if (mimeType.startsWith("application/pdf") || mimeType.includes("document")) {
    return <FileText size={14} className="text-white/40" />;
  }
  return <Paperclip size={14} className="text-white/40" />;
}

const RSVP_OPTIONS: { status: CalendarRsvpStatus; label: string }[] = [
  { status: "accepted", label: "Accept" },
  { status: "tentative", label: "Tentative" },
  { status: "declined", label: "Decline" },
];

function rsvpButtonClasses(
  option: CalendarRsvpStatus,
  isActive: boolean,
): string {
  const base =
    "flex-1 px-3 py-1.5 rounded-md text-xs font-medium transition-colors border";
  if (!isActive) {
    return `${base} bg-white/5 text-white/60 border-white/10 hover:bg-white/10 hover:text-white`;
  }
  switch (option) {
    case "accepted":
      return `${base} bg-green-500/20 text-green-400 border-green-500/20`;
    case "tentative":
      return `${base} bg-yellow-500/20 text-yellow-400 border-yellow-500/20`;
    case "declined":
      return `${base} bg-red-500/20 text-red-400 border-red-500/20`;
    default:
      return `${base} bg-white/10 text-white border-white/10`;
  }
}

export function CalendarEventDetailPanel({
  detail,
  onClose,
  onUpdateRsvp,
  onUpdateNotes,
  brettMessages,
  brettTotalCount,
  brettHasMore,
  onSendBrettMessage,
  onLoadMoreBrettMessages,
  isSendingBrettMessage,
  isBrettStreaming,
  isLoadingMoreBrettMessages,
  brettAiConfigured,
  onOpenSettings,
  meetingNote,
  onToggleActionItem,
  onSelectActionItem,
  onReprocessActionItems,
  isReprocessing,
  onItemClick,
  onEventClick,
  onNavigate,
}: CalendarEventDetailPanelProps) {
  const [showAllAttendees, setShowAllAttendees] = useState(false);
  const [rsvpNote, setRsvpNote] = useState("");
  const [selectedRsvp, setSelectedRsvp] = useState<CalendarRsvpStatus>(
    detail.myResponseStatus,
  );
  const rsvpNoteRef = useRef<HTMLInputElement>(null);

  // Sync RSVP state from server only when switching to a different event.
  // After that, local state is authoritative (managed by handleRsvpClick
  // and the optimistic update). This prevents refetch-induced flicker.
  useEffect(() => {
    const selfAttendee = detail.attendees?.find(
      (a: CalendarAttendee) => a.self === true,
    );
    setRsvpNote(selfAttendee?.comment ?? "");
    setSelectedRsvp(detail.myResponseStatus);
    setShowAllAttendees(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail.id]);

  const handleRsvpClick = useCallback(
    (status: CalendarRsvpStatus) => {
      setSelectedRsvp(status);
      onUpdateRsvp(status, rsvpNote.trim());
    },
    [rsvpNote, onUpdateRsvp],
  );

  const handleRsvpNoteBlur = useCallback(() => {
    // If RSVP already selected, fire update with note
    if (selectedRsvp && selectedRsvp !== "needsAction" && rsvpNote.trim()) {
      onUpdateRsvp(selectedRsvp, rsvpNote.trim());
    }
  }, [selectedRsvp, rsvpNote, onUpdateRsvp]);

  const visibleAttendees = showAllAttendees
    ? detail.attendees
    : detail.attendees?.slice(0, 4);
  const hiddenCount = (detail.attendees?.length ?? 0) - 4;

  return (
    <>
      <div className="flex-1 overflow-y-auto scrollbar-hide overscroll-contain">
        <div className="p-6 space-y-0">
          {/* ── Header ── */}
          <div className="pb-4">
            <div className="flex items-start justify-between gap-3 mb-2">
              <h2 className="text-2xl font-semibold text-white leading-tight">
                {detail.title}
              </h2>
              <button
                onClick={onClose}
                className="p-1.5 text-white/50 hover:text-white hover:bg-white/10 rounded-full transition-colors flex-shrink-0 mt-0.5"
              >
                <X size={16} />
              </button>
            </div>
            <p className="text-sm text-white/60 mb-2">
              {formatEventTime(detail.startTime, detail.endTime, detail.isAllDay)}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {/* Calendar badge */}
              <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white/5 border border-white/10 text-xs text-white/70">
                <span
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: detail.calendarColor }}
                />
                {detail.calendarName}
              </span>
              {/* Location */}
              {detail.location && (
                <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white/5 border border-white/10 text-xs text-white/70">
                  <MapPin size={12} className="text-white/40" />
                  {detail.location}
                </span>
              )}
              {/* Meeting link */}
              {detail.meetingLink && isSafeUrl(detail.meetingLink) && (
                <a
                  href={detail.meetingLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-brett-gold/10 border border-brett-gold/20 text-xs text-brett-gold hover:bg-brett-gold/20 transition-colors"
                >
                  <Video size={12} />
                  Join meeting
                </a>
              )}
              {/* Recurrence badge */}
              {detail.recurrence && (
                <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-brett-gold/20 text-brett-gold border border-brett-gold/20">
                  <RefreshCw size={10} />
                  {detail.recurrence}
                </span>
              )}
            </div>
          </div>

          {/* ── RSVP ── */}
          <div
            className="pt-4"
            style={{
              borderTop: "1px solid rgba(255,255,255,0.06)",
              marginLeft: 0,
              marginRight: 0,
            }}
          >
            <span className="font-mono text-xs uppercase tracking-wider text-white/40 font-semibold mb-3 block">
              Your Response
            </span>
            <div className="flex gap-2 mb-2">
              {RSVP_OPTIONS.map((opt) => (
                <button
                  key={opt.status}
                  onClick={() => handleRsvpClick(opt.status)}
                  className={rsvpButtonClasses(
                    opt.status,
                    selectedRsvp === opt.status,
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <input
              ref={rsvpNoteRef}
              value={rsvpNote}
              onChange={(e) => setRsvpNote(e.target.value)}
              onBlur={handleRsvpNoteBlur}
              placeholder="Add a note (optional)"
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-brett-cerulean/20 outline-none"
            />
          </div>

          {/* ── Brett's Take ── */}
          {detail.brettObservation && (
            <div
              className="pt-4"
              style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}
            >
              <div className="bg-brett-cerulean/10 border-l-2 border-brett-cerulean p-4 rounded-r-lg">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-brett-cerulean" />
                  <span className="text-[10px] uppercase tracking-[0.15em] font-semibold text-brett-cerulean">
                    Brett&apos;s Take
                  </span>
                </div>
                <p className="text-sm italic text-brett-cerulean/85 leading-relaxed">
                  &ldquo;{detail.brettObservation}&rdquo;
                </p>
              </div>
            </div>
          )}

          {/* ── Agenda ── */}
          {(detail.description || (detail.attachments && detail.attachments.length > 0)) && (
            <div
              className="pt-4"
              style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}
            >
              <span className="font-mono text-xs uppercase tracking-wider text-white/40 font-semibold mb-3 block">
                Agenda
              </span>
              {detail.description && (
                <div
                  className="text-sm text-white/80 leading-relaxed mb-3 [&_a]:text-brett-gold [&_a]:underline [&_a]:underline-offset-2 [&_a:hover]:text-brett-gold/80"
                  dangerouslySetInnerHTML={{
                    __html: DOMPurify.sanitize(detail.description, {
                      ALLOWED_TAGS: ["p", "br", "b", "i", "em", "strong", "a", "ul", "ol", "li", "h1", "h2", "h3", "blockquote", "pre", "code"],
                      ALLOWED_ATTR: ["href", "target", "rel"],
                      ALLOW_DATA_ATTR: false,
                    }),
                  }}
                />
              )}
              {detail.attachments && detail.attachments.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  {detail.attachments.map((att, idx) => (
                    <a
                      key={idx}
                      href={isSafeUrl(att.url) ? att.url : "#"}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => { if (!isSafeUrl(att.url)) e.preventDefault(); }}
                      className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 transition-colors group"
                    >
                      <AttachmentIcon mimeType={att.mimeType} />
                      <span className="text-sm text-white/70 truncate flex-1">
                        {att.title}
                      </span>
                      <ExternalLink
                        size={12}
                        className="text-white/20 group-hover:text-white/50 transition-colors"
                      />
                    </a>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── Meeting Notes (Granola) ── */}
          {meetingNote && (
            <div
              className="pt-4"
              style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}
            >
              <div className="flex items-center justify-between mb-3">
                <span className="font-mono text-xs uppercase tracking-wider text-white/40 font-semibold">
                  Meeting Notes
                </span>
                {onReprocessActionItems && meetingNote.id && (
                  <button
                    onClick={() => onReprocessActionItems(meetingNote!.id)}
                    disabled={isReprocessing}
                    className="text-[10px] text-white/30 hover:text-white/60 transition-colors disabled:opacity-30"
                    title="Reprocess action items"
                  >
                    <RefreshCw className={`w-3 h-3 ${isReprocessing ? "animate-spin" : ""}`} />
                  </button>
                )}
              </div>

              {/* Summary */}
              {meetingNote.summary && (
                <SimpleMarkdown
                  content={meetingNote.summary}
                  className="text-sm text-white/60 leading-relaxed mb-3"
                />
              )}

              {/* Linked Tasks (real Item records) */}
              {meetingNote.items && meetingNote.items.length > 0 && (
                <div className="mb-3">
                  <span className="text-[10px] uppercase tracking-wider text-white/30 font-semibold mb-1.5 block">
                    Tasks
                  </span>
                  <div className="flex flex-col gap-0.5">
                    {meetingNote.items.map((item) => {
                      const isDone = item.status === "done";
                      return (
                        <div
                          key={item.id}
                          className="flex items-center gap-2 px-1 py-1 rounded hover:bg-white/5 transition-colors group"
                        >
                          <button
                            onClick={() => onToggleActionItem?.(item.id)}
                            className={`w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center transition-colors ${
                              isDone
                                ? "bg-white/10 border-white/20"
                                : "border-white/20 hover:border-white/40"
                            }`}
                          >
                            {isDone && <Check className="w-2.5 h-2.5 text-white/40" />}
                          </button>
                          <span
                            onClick={() => onSelectActionItem?.(item.id)}
                            className={`flex-1 text-sm truncate cursor-pointer ${
                              isDone ? "text-white/30 line-through" : "text-white/70 hover:text-white/90"
                            }`}
                          >
                            {item.title}
                          </span>
                          {item.dueDate && (
                            <span className="text-[10px] text-white/30 flex-shrink-0">
                              {new Date(item.dueDate).toLocaleDateString(undefined, {
                                month: "short",
                                day: "numeric",
                              })}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Raw action items as bullet points (when no linked tasks exist) */}
              {(!meetingNote.items || meetingNote.items.length === 0) &&
                meetingNote.actionItems && meetingNote.actionItems.length > 0 && (
                <div className="mb-3">
                  <span className="text-[10px] uppercase tracking-wider text-white/30 font-semibold mb-1.5 block">
                    Action Items
                  </span>
                  <ul className="space-y-1 pl-3">
                    {meetingNote.actionItems.map((item, idx) => (
                      <li key={idx} className="text-sm text-white/50 list-disc list-outside">
                        {item.title}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Transcript */}
              {meetingNote.transcript && meetingNote.transcript.length > 0 && (() => {
                // Combine all turns into one text, split into readable paragraphs
                const fullText = meetingNote.transcript!
                  .map((t) => t.text)
                  .join(" ")
                  .replace(/^(Them|You|Me):\s*/i, ""); // strip leading speaker label

                // Break into paragraphs roughly every 3-5 sentences
                const sentences = fullText.split(/(?<=[.!?])\s+/);
                const paragraphs: string[] = [];
                let current: string[] = [];
                for (const s of sentences) {
                  current.push(s);
                  if (current.length >= 4) {
                    paragraphs.push(current.join(" "));
                    current = [];
                  }
                }
                if (current.length > 0) paragraphs.push(current.join(" "));

                return (
                  <details className="group">
                    <summary className="text-[10px] uppercase tracking-wider text-white/30 font-semibold cursor-pointer hover:text-white/50 transition-colors select-none">
                      Transcript
                    </summary>
                    <div className="mt-2 max-h-64 overflow-y-auto scrollbar-hide bg-white/5 rounded-lg p-3 border border-white/5 space-y-2">
                      {paragraphs.map((para, idx) => (
                        <p key={idx} className="text-xs text-white/50 leading-relaxed">
                          {para}
                        </p>
                      ))}
                    </div>
                  </details>
                );
              })()}
            </div>
          )}

          {/* ── Attendees ── */}
          {detail.attendees && detail.attendees.length > 0 && (
            <div
              className="pt-4"
              style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}
            >
              <span className="font-mono text-xs uppercase tracking-wider text-white/40 font-semibold mb-3 block">
                Attendees &middot; {detail.attendees.length}
              </span>
              <div className="flex flex-col gap-1.5">
                {visibleAttendees?.map((attendee, idx) => {
                  const name = attendee.name || attendee.email || "Unknown";
                  return (
                  <div
                    key={idx}
                    className="flex items-center gap-3 bg-white/5 p-2 rounded-lg border border-white/5"
                  >
                    <AttendeeAvatar photoUrl={attendee.photoUrl} name={name} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-white/90 truncate">
                          {name}
                        </span>
                        {attendee.organizer && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-white/10 text-white/50">
                            Organizer
                          </span>
                        )}
                      </div>
                      <span className="text-xs text-white/40 truncate block">
                        {attendee.email}
                      </span>
                    </div>
                    <ResponseStatusIcon status={attendee.responseStatus} />
                  </div>
                  );
                })}
              </div>
              {!showAllAttendees && hiddenCount > 0 && (
                <button
                  onClick={() => setShowAllAttendees(true)}
                  className="mt-2 text-xs text-brett-gold hover:text-brett-gold/80 transition-colors"
                >
                  +{hiddenCount} more
                </button>
              )}
              {showAllAttendees && hiddenCount > 0 && (
                <button
                  onClick={() => setShowAllAttendees(false)}
                  className="mt-2 text-xs text-brett-gold hover:text-brett-gold/80 transition-colors"
                >
                  Show less
                </button>
              )}
            </div>
          )}

          {/* ── Your Notes ── */}
          <div
            className="pt-4"
            style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}
          >
            <span className="font-mono text-xs uppercase tracking-wider text-white/40 font-semibold mb-2 block">
              Your Notes
            </span>
            <p className="text-[10px] text-white/20 mb-2">Not synced to Google</p>
            <RichTextEditor
              content={detail.notes ?? ""}
              onChange={onUpdateNotes}
              placeholder="Add notes…"
            />
          </div>

          {/* Bottom spacer */}
          <div className="h-2" />
        </div>
      </div>

      {/* ── Brett Thread — pinned outside scroll area ── */}
      <BrettThread
        messages={brettMessages}
        hasMore={brettHasMore}
        onSend={onSendBrettMessage}
        onLoadMore={onLoadMoreBrettMessages}
        isSending={isSendingBrettMessage}
        isStreaming={isBrettStreaming}
        isLoadingMore={isLoadingMoreBrettMessages}
        totalCount={brettTotalCount}
        onItemClick={onItemClick}
        onEventClick={onEventClick}
        onNavigate={onNavigate}
        aiConfigured={brettAiConfigured}
        onOpenSettings={onOpenSettings}
      />
    </>
  );
}
