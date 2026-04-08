import React, { useState, useRef, useEffect } from "react";
import { Calendar, CheckCircle, Radar, RotateCw, ThumbsUp, ThumbsDown, X } from "lucide-react";
import type {
  ThingDetail,
  DueDatePrecision,
  ReminderType,
  RecurrenceType,
  Attachment,
  ItemLink,
  Thing,
} from "@brett/types";
import { OverflowMenu } from "./OverflowMenu";
import { Tooltip } from "./Tooltip";
import { ScheduleRow } from "./ScheduleRow";
import { RichTextEditor } from "./RichTextEditor";
import { AttachmentList } from "./AttachmentList";
import { LinkedItemsList } from "./LinkedItemsList";
import type { SuggestionItem } from "./LinkedItemsList";
import { BrettThread } from "./BrettThread";
import type { BrettThreadMessage } from "./BrettThread";

interface TaskDetailPanelProps {
  detail: ThingDetail;
  onClose: () => void;
  onUpdate: (updates: Record<string, unknown>) => void;
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
  onMoveToList: (id: string) => void;
  // Schedule callbacks
  onUpdateDueDate?: (dueDate: string | null, precision: DueDatePrecision) => void;
  onUpdateReminder?: (reminder: ReminderType | null) => void;
  onUpdateRecurrence?: (recurrence: RecurrenceType | null) => void;
  // Notes
  onUpdateNotes?: (notes: string) => void;
  // Attachments
  onUploadAttachment?: (file: File) => void;
  onDeleteAttachment?: (attachmentId: string) => void;
  isUploadingAttachment?: boolean;
  // Links
  onAddLink?: (toItemId: string, toItemType: string) => void;
  onRemoveLink?: (linkId: string) => void;
  searchItems?: (query: string) => Promise<Thing[]>;
  // Suggestions
  suggestions?: SuggestionItem[];
  onPromoteSuggestion?: (entityId: string, type: string) => void;
  // Brett thread
  brettMessages?: BrettThreadMessage[];
  brettHasMore?: boolean;
  onSendBrettMessage?: (content: string) => void;
  onLoadMoreBrettMessages?: () => void;
  isSendingBrettMessage?: boolean;
  isBrettStreaming?: boolean;
  isLoadingMoreBrettMessages?: boolean;
  brettTotalCount?: number;
  brettAiConfigured?: boolean;
  onOpenSettings?: () => void;
  onNavigateToCalendarEvent?: (calendarEventId: string) => void;
  onNavigateToScout?: (scoutId: string) => void;
  onScoutFeedback?: (scoutId: string, findingId: string, useful: boolean | null) => void;
  onApproveNewsletter?: (pendingId: string) => void;
  onBlockNewsletter?: (pendingId: string) => void;
  onItemClick?: (id: string) => void;
  onEventClick?: (eventId: string) => void;
  onNavigate?: (path: string) => void;
  assistantName?: string;
}

function isNewsletterApproval(meta: unknown): meta is { newsletterApproval: true; pendingNewsletterId: string; senderEmail: string; senderName: string } {
  return !!meta && typeof meta === "object" && (meta as any).newsletterApproval === true && typeof (meta as any).pendingNewsletterId === "string";
}

export function TaskDetailPanel({
  detail,
  onClose,
  onUpdate,
  onToggle,
  onDelete,
  onDuplicate,
  onMoveToList,
  onUpdateDueDate,
  onUpdateReminder,
  onUpdateRecurrence,
  onUpdateNotes,
  onUploadAttachment,
  onDeleteAttachment,
  isUploadingAttachment,
  onAddLink,
  onRemoveLink,
  searchItems,
  suggestions,
  onPromoteSuggestion,
  brettMessages,
  brettHasMore,
  onSendBrettMessage,
  onLoadMoreBrettMessages,
  isSendingBrettMessage,
  isBrettStreaming,
  isLoadingMoreBrettMessages,
  brettTotalCount,
  brettAiConfigured,
  onOpenSettings,
  onNavigateToCalendarEvent,
  onNavigateToScout,
  onScoutFeedback,
  onApproveNewsletter,
  onBlockNewsletter,
  onItemClick,
  onEventClick,
  onNavigate,
  assistantName,
}: TaskDetailPanelProps) {
  const isApproval = isNewsletterApproval(detail.contentMetadata);
  const pendingNewsletterId = isApproval ? (detail.contentMetadata as any).pendingNewsletterId : undefined;

  const [editingTitle, setEditingTitle] = useState(false);
  const [titleValue, setTitleValue] = useState(detail.title);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTitleValue(detail.title);
  }, [detail.title]);

  useEffect(() => {
    if (editingTitle) titleRef.current?.focus();
  }, [editingTitle]);

  const commitTitle = () => {
    setEditingTitle(false);
    const trimmed = titleValue.trim();
    if (trimmed && trimmed !== detail.title) {
      onUpdate({ title: trimmed });
    } else {
      setTitleValue(detail.title);
    }
  };

  return (
    <>
      <div className="flex-1 overflow-y-auto scrollbar-hide overscroll-contain">
        <div className="p-6 space-y-6">
          {/* Header: label + recurrence badge + actions */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-[10px] uppercase tracking-[0.15em] font-semibold text-white/40">
                Task
              </span>
              {detail.recurrence && (
                <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-brett-gold/20 text-brett-gold border border-brett-gold/20">
                  <RotateCw size={10} />
                  {detail.recurrence}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => onToggle(detail.id)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors border ${
                  detail.isCompleted
                    ? "bg-brett-teal/20 text-brett-teal border-brett-teal/20 hover:bg-brett-teal/30"
                    : "bg-white/5 text-white/60 border-white/10 hover:bg-white/10 hover:text-white"
                }`}
              >
                <CheckCircle size={12} />
                {detail.isCompleted ? "Done" : "Complete"}
              </button>
              <OverflowMenu
                onDelete={() => onDelete(detail.id)}
                onDuplicate={() => onDuplicate(detail.id)}
                onMoveToList={() => onMoveToList(detail.id)}
                onCopyLink={() =>
                  navigator.clipboard.writeText(`brett://things/${detail.id}`)
                }
              />
              <button
                onClick={onClose}
                className="p-1.5 text-white/50 hover:text-white hover:bg-white/10 rounded-full transition-colors"
              >
                <X size={16} />
              </button>
            </div>
          </div>

          {/* Editable title */}
          {editingTitle ? (
            <input
              ref={titleRef}
              value={titleValue}
              onChange={(e) => setTitleValue(e.target.value)}
              onBlur={commitTitle}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitTitle();
                if (e.key === "Escape") {
                  setTitleValue(detail.title);
                  setEditingTitle(false);
                }
              }}
              className="w-full text-2xl font-semibold text-white bg-transparent border-b border-brett-gold/30 outline-none pb-1"
            />
          ) : (
            <h2
              onClick={() => setEditingTitle(true)}
              className="text-2xl font-semibold text-white leading-tight cursor-text hover:border-b hover:border-white/20 pb-1 transition-colors"
            >
              {detail.title}
            </h2>
          )}

          {/* Meeting provenance */}
          {detail.source === "Granola" && detail.meetingNoteTitle && (
            <button
              onClick={() => detail.meetingNoteCalendarEventId && onNavigateToCalendarEvent?.(detail.meetingNoteCalendarEventId)}
              className={`flex items-center gap-1.5 text-xs text-brett-cerulean/60 ${
                detail.meetingNoteCalendarEventId && onNavigateToCalendarEvent
                  ? "hover:text-brett-cerulean cursor-pointer"
                  : "cursor-default"
              } transition-colors`}
            >
              <Calendar className="w-3 h-3" />
              <span>from {detail.meetingNoteTitle}</span>
            </button>
          )}

          {/* Scout provenance + feedback */}
          {detail.source === "scout" && detail.scoutName && detail.scoutId && (
            <div className="flex items-center gap-3">
              <button
                onClick={() => onNavigateToScout?.(detail.scoutId!)}
                className="flex items-center gap-1.5 text-xs text-brett-cerulean/60 hover:text-brett-cerulean cursor-pointer transition-colors"
              >
                <Radar className="w-3 h-3" />
                <span>from {detail.scoutName}</span>
              </button>
              {detail.scoutFindingId && (
                <div className="flex items-center gap-1.5">
                  <Tooltip content="Helpful — scout will find more like this">
                    <button
                      onClick={() => onScoutFeedback?.(detail.scoutId!, detail.scoutFindingId!, detail.scoutFeedbackUseful === true ? null : true)}
                      className={`p-1.5 rounded-md transition-colors ${
                        detail.scoutFeedbackUseful === true
                          ? "text-emerald-400 bg-emerald-500/15"
                          : "text-white/40 hover:text-white/60 hover:bg-white/10"
                      }`}
                    >
                      <ThumbsUp className="w-3.5 h-3.5" />
                    </button>
                  </Tooltip>
                  <Tooltip content="Not helpful — scout will learn to skip these">
                    <button
                      onClick={() => onScoutFeedback?.(detail.scoutId!, detail.scoutFindingId!, detail.scoutFeedbackUseful === false ? null : false)}
                      className={`p-1.5 rounded-md transition-colors ${
                        detail.scoutFeedbackUseful === false
                          ? "text-red-400 bg-red-500/15"
                          : "text-white/40 hover:text-white/60 hover:bg-white/10"
                      }`}
                    >
                      <ThumbsDown className="w-3.5 h-3.5" />
                    </button>
                  </Tooltip>
                </div>
              )}
            </div>
          )}

          {/* Newsletter approval actions */}
          {isApproval && pendingNewsletterId && (
            <div className="flex items-center gap-2 pt-3 border-t border-white/10">
              <button
                onClick={() => onApproveNewsletter?.(pendingNewsletterId)}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-brett-gold/20 text-brett-gold border border-brett-gold/30 hover:bg-brett-gold/30 transition-colors"
              >
                Approve Sender
              </button>
              <button
                onClick={() => onBlockNewsletter?.(pendingNewsletterId)}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-white/5 text-white/50 border border-white/10 hover:bg-red-500/20 hover:text-red-400 hover:border-red-500/30 transition-colors"
              >
                Block Sender
              </button>
            </div>
          )}

          {/* Schedule Row */}
          {onUpdateDueDate && onUpdateReminder && onUpdateRecurrence && (
            <ScheduleRow
              dueDate={detail.dueDate}
              dueDateLabel={detail.dueDateLabel}
              dueDatePrecision={detail.dueDatePrecision}
              reminder={detail.reminder}
              recurrence={detail.recurrence}
              onUpdateDueDate={onUpdateDueDate}
              onUpdateReminder={onUpdateReminder}
              onUpdateRecurrence={onUpdateRecurrence}
            />
          )}

          {/* Rich Notes */}
          {onUpdateNotes && (
            <div>
              <span className="text-[10px] uppercase tracking-[0.15em] font-semibold text-white/40 mb-2 block">
                Notes
              </span>
              <RichTextEditor
                content={detail.notes ?? ""}
                onChange={onUpdateNotes}
              />
            </div>
          )}

          {/* Description fallback (only if no notes editor) */}
          {detail.description && !onUpdateNotes && !detail.notes && (
            <div className="text-sm text-white/80 leading-relaxed">
              {detail.description}
            </div>
          )}

          {/* Attachments */}
          {onUploadAttachment && onDeleteAttachment && (
            <AttachmentList
              attachments={detail.attachments}
              onUpload={onUploadAttachment}
              onDelete={onDeleteAttachment}
              isUploading={isUploadingAttachment}
            />
          )}

          {/* Linked Items */}
          {onAddLink && onRemoveLink && searchItems && (
            <LinkedItemsList
              links={detail.links}
              onAddLink={onAddLink}
              onRemoveLink={onRemoveLink}
              searchItems={searchItems}
              suggestions={suggestions}
              onPromoteSuggestion={onPromoteSuggestion}
            />
          )}

          {/* Bottom spacer for scroll breathing room */}
          <div className="h-2" />
        </div>
      </div>

      {/* Brett Thread — pinned outside scroll area */}
      {onSendBrettMessage && onLoadMoreBrettMessages && (
        <BrettThread
          messages={brettMessages ?? []}
          hasMore={brettHasMore ?? false}
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
          assistantName={assistantName}
        />
      )}
    </>
  );
}
