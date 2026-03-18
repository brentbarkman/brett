import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
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
import type {
  CalendarEventDetailResponse,
  CalendarRsvpStatus,
  BrettMessageRecord,
  CalendarAttendee,
} from "@brett/types";
import { isSafeUrl } from "@brett/utils";
import { RichTextEditor } from "./RichTextEditor";
import { BrettThread } from "./BrettThread";

/** Attendee avatar — tries Google profile photo, falls back to initials */
function AttendeeAvatar({ email, name }: { email?: string; name: string }) {
  const [imgError, setImgError] = useState(false);
  const initials = name.split(" ").map((n: string) => n[0]).join("").slice(0, 2).toUpperCase();

  // Google Workspace profile photo URL — works for org accounts with public photos
  const photoUrl = useMemo(() => {
    if (!email) return null;
    // Google's public profile photo endpoint (works for Workspace accounts)
    return `https://contacts.google.com/widget/hovercard/photo?email=${encodeURIComponent(email)}`;
  }, [email]);

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
  onUpdateRsvp: (status: CalendarRsvpStatus, comment?: string) => void;
  onUpdateNotes: (content: string) => void;
  brettMessages: BrettMessageRecord[];
  brettTotalCount: number;
  brettHasMore: boolean;
  onSendBrettMessage: (content: string) => void;
  onLoadMoreBrettMessages: () => void;
  isSendingBrettMessage: boolean;
  isLoadingMoreBrettMessages: boolean;
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
  onUpdateRsvp,
  onUpdateNotes,
  brettMessages,
  brettTotalCount,
  brettHasMore,
  onSendBrettMessage,
  onLoadMoreBrettMessages,
  isSendingBrettMessage,
  isLoadingMoreBrettMessages,
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
      const note = rsvpNote.trim() || undefined;
      onUpdateRsvp(status, note);
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
            <h2 className="text-2xl font-semibold text-white leading-tight mb-2">
              {detail.title}
            </h2>
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
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-blue-500/10 border border-blue-500/20 text-xs text-blue-400 hover:bg-blue-500/20 transition-colors"
                >
                  <Video size={12} />
                  Join meeting
                </a>
              )}
              {/* Recurrence badge */}
              {detail.recurrence && (
                <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-500/20 text-blue-400 border border-blue-500/20">
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
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-blue-500/20 outline-none"
            />
          </div>

          {/* ── Brett's Take ── */}
          {detail.brettObservation && (
            <div
              className="pt-4"
              style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}
            >
              <div className="bg-purple-500/10 border-l-2 border-purple-500 p-4 rounded-r-lg">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-purple-500" />
                  <span className="text-xs font-mono uppercase text-purple-400 font-semibold">
                    Brett&apos;s Take
                  </span>
                </div>
                <p className="text-sm italic text-purple-300/90 leading-relaxed">
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
                <div className="text-sm text-white/80 leading-relaxed whitespace-pre-wrap mb-3">
                  {detail.description}
                </div>
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
                    <AttendeeAvatar email={attendee.email} name={name} />
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
                  className="mt-2 text-xs text-blue-400 hover:text-blue-300 transition-colors"
                >
                  +{hiddenCount} more
                </button>
              )}
              {showAllAttendees && hiddenCount > 0 && (
                <button
                  onClick={() => setShowAllAttendees(false)}
                  className="mt-2 text-xs text-blue-400 hover:text-blue-300 transition-colors"
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
            <p className="text-[10px] text-white/25 mb-2">Not synced to Google</p>
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
        isLoadingMore={isLoadingMoreBrettMessages}
        totalCount={brettTotalCount}
      />
    </>
  );
}
