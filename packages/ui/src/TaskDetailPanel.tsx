import React, { useState, useRef, useEffect } from "react";
import { CheckCircle, RotateCw, X } from "lucide-react";
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
import { ScheduleRow } from "./ScheduleRow";
import { RichTextEditor } from "./RichTextEditor";
import { AttachmentList } from "./AttachmentList";
import { LinkedItemsList } from "./LinkedItemsList";
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
  // Brett thread
  brettMessages?: BrettThreadMessage[];
  brettHasMore?: boolean;
  onSendBrettMessage?: (content: string) => void;
  onLoadMoreBrettMessages?: () => void;
  isSendingBrettMessage?: boolean;
  isBrettStreaming?: boolean;
  isLoadingMoreBrettMessages?: boolean;
  brettTotalCount?: number;
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
  brettMessages,
  brettHasMore,
  onSendBrettMessage,
  onLoadMoreBrettMessages,
  isSendingBrettMessage,
  isBrettStreaming,
  isLoadingMoreBrettMessages,
  brettTotalCount,
}: TaskDetailPanelProps) {
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
              <span className="font-mono text-xs uppercase tracking-wider text-white/40 font-semibold">
                Task
              </span>
              {detail.recurrence && (
                <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-500/20 text-blue-400 border border-blue-500/20">
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
                    ? "bg-green-500/20 text-green-400 border-green-500/20 hover:bg-green-500/30"
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
              className="w-full text-2xl font-semibold text-white bg-transparent border-b border-blue-500/30 outline-none pb-1"
            />
          ) : (
            <h2
              onClick={() => setEditingTitle(true)}
              className="text-2xl font-semibold text-white leading-tight cursor-text hover:border-b hover:border-white/20 pb-1 transition-colors"
            >
              {detail.title}
            </h2>
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

          {/* Brett's Take */}
          {detail.brettObservation && (
            <div className="bg-blue-500/10 border-l-2 border-blue-500 p-4 rounded-r-lg">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                <span className="text-xs font-mono uppercase text-blue-400 font-semibold">
                  Brett's Take
                </span>
              </div>
              <p className="text-sm italic text-blue-300/90 leading-relaxed">
                &ldquo;{detail.brettObservation}&rdquo;
              </p>
            </div>
          )}

          {/* Rich Notes */}
          {onUpdateNotes && (
            <div>
              <span className="font-mono text-xs uppercase tracking-wider text-white/40 font-semibold mb-2 block">
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
        />
      )}
    </>
  );
}
