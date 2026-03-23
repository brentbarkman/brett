import React from "react";
import { X, Calendar, MapPin, Users, Loader2 } from "lucide-react";
import type {
  Thing,
  CalendarEventDisplay,
  ThingDetail,
  CalendarEventDetailResponse,
  CalendarRsvpStatus,
  BrettMessageRecord,
  DueDatePrecision,
  ReminderType,
  RecurrenceType,
  BrettMessage,
} from "@brett/types";
import { TaskDetailPanel } from "./TaskDetailPanel";
import { ContentDetailPanel } from "./ContentDetailPanel";
import { CalendarEventDetailPanel } from "./CalendarEventDetailPanel";

interface DetailPanelProps {
  isOpen: boolean;
  item: Thing | CalendarEventDisplay | null;
  onClose: () => void;
  onToggle?: (id: string) => void;
  detail?: ThingDetail | null;
  isLoadingDetail?: boolean;
  onUpdate?: (updates: Record<string, unknown>) => void;
  onDelete?: (id: string) => void;
  onDuplicate?: (id: string) => void;
  onMoveToList?: (id: string) => void;
  // Schedule
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
  brettMessages?: BrettMessage[];
  brettHasMore?: boolean;
  onSendBrettMessage?: (content: string) => void;
  onLoadMoreBrettMessages?: () => void;
  isSendingBrettMessage?: boolean;
  isLoadingMoreBrettMessages?: boolean;
  brettTotalCount?: number;
  // Content extraction
  onRetryExtraction?: () => void;
  // Calendar event callbacks
  calendarEventDetail?: CalendarEventDetailResponse | null;
  isLoadingCalendarDetail?: boolean;
  onUpdateRsvp?: (status: CalendarRsvpStatus, comment?: string) => void;
  onUpdateCalendarNotes?: (content: string) => void;
  calendarBrettMessages?: BrettMessageRecord[];
  calendarBrettTotalCount?: number;
  calendarBrettHasMore?: boolean;
  onSendCalendarBrettMessage?: (content: string) => void;
  onLoadMoreCalendarBrettMessages?: () => void;
  isSendingCalendarBrettMessage?: boolean;
  isLoadingMoreCalendarBrettMessages?: boolean;
}

export function DetailPanel({
  isOpen,
  item,
  onClose,
  onToggle,
  detail,
  isLoadingDetail,
  onUpdate,
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
  isLoadingMoreBrettMessages,
  brettTotalCount,
  onRetryExtraction,
  calendarEventDetail,
  isLoadingCalendarDetail,
  onUpdateRsvp,
  onUpdateCalendarNotes,
  calendarBrettMessages,
  calendarBrettTotalCount,
  calendarBrettHasMore,
  onSendCalendarBrettMessage,
  onLoadMoreCalendarBrettMessages,
  isSendingCalendarBrettMessage,
  isLoadingMoreCalendarBrettMessages,
}: DetailPanelProps) {
  if (!item) return null;
  const isCalendarEvent = "googleEventId" in item;
  // Derive type from freshly-fetched detail when available (handles converted_to_task transitions)
  const effectiveType = (detail?.type) ?? (!isCalendarEvent && "type" in item ? (item as Thing).type : undefined);
  const isContent = !isCalendarEvent && effectiveType === "content";
  const isTask = !isCalendarEvent && !isContent;

  return (
    <>
      {/* Backdrop — click to dismiss */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/20 transition-opacity"
          onClick={onClose}
        />
      )}
      <div
        className={`
          fixed top-0 right-0 bottom-0 w-[550px] bg-black/60 backdrop-blur-2xl border-l border-white/10
          shadow-2xl z-50 transform transition-transform duration-300 ease-out flex flex-col overscroll-contain
          ${isOpen ? "translate-x-0" : "translate-x-full"}
        `}
      >
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-white/10">
        <span className="font-mono text-xs uppercase tracking-wider text-white/40">
          {isCalendarEvent ? "Event" : isContent ? "Content" : "Detail"}
        </span>
        <button
          onClick={onClose}
          className="p-1.5 text-white/50 hover:text-white hover:bg-white/10 rounded-full transition-colors"
        >
          <X size={16} />
        </button>
      </div>

      {/* Content */}
      {isTask ? (
        isLoadingDetail ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 size={24} className="text-white/30 animate-spin" />
          </div>
        ) : detail ? (
          <TaskDetailPanel
            detail={detail}
            onUpdate={onUpdate ?? (() => {})}
            onToggle={onToggle ?? (() => {})}
            onDelete={onDelete ?? (() => {})}
            onDuplicate={onDuplicate ?? (() => {})}
            onMoveToList={onMoveToList ?? (() => {})}
            onUpdateDueDate={onUpdateDueDate}
            onUpdateReminder={onUpdateReminder}
            onUpdateRecurrence={onUpdateRecurrence}
            onUpdateNotes={onUpdateNotes}
            onUploadAttachment={onUploadAttachment}
            onDeleteAttachment={onDeleteAttachment}
            isUploadingAttachment={isUploadingAttachment}
            onAddLink={onAddLink}
            onRemoveLink={onRemoveLink}
            searchItems={searchItems}
            brettMessages={brettMessages}
            brettHasMore={brettHasMore}
            onSendBrettMessage={onSendBrettMessage}
            onLoadMoreBrettMessages={onLoadMoreBrettMessages}
            isSendingBrettMessage={isSendingBrettMessage}
            isLoadingMoreBrettMessages={isLoadingMoreBrettMessages}
            brettTotalCount={brettTotalCount}
          />
        ) : (
          <div className="flex-1 overflow-y-auto p-6 scrollbar-hide">
            <h2 className="text-2xl font-semibold text-white mb-6 leading-tight">
              {item.title}
            </h2>
          </div>
        )
      ) : isContent ? (
        isLoadingDetail ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 size={24} className="text-white/30 animate-spin" />
          </div>
        ) : detail ? (
          <ContentDetailPanel
            detail={detail}
            onUpdate={onUpdate ?? (() => {})}
            onToggle={onToggle ?? (() => {})}
            onDelete={onDelete ?? (() => {})}
            onDuplicate={onDuplicate ?? (() => {})}
            onMoveToList={onMoveToList ?? (() => {})}
            onUpdateDueDate={onUpdateDueDate}
            onUpdateReminder={onUpdateReminder}
            onUpdateRecurrence={onUpdateRecurrence}
            onUpdateNotes={onUpdateNotes}
            onUploadAttachment={onUploadAttachment}
            onDeleteAttachment={onDeleteAttachment}
            isUploadingAttachment={isUploadingAttachment}
            onAddLink={onAddLink}
            onRemoveLink={onRemoveLink}
            searchItems={searchItems}
            brettMessages={brettMessages}
            brettHasMore={brettHasMore}
            onSendBrettMessage={onSendBrettMessage}
            onLoadMoreBrettMessages={onLoadMoreBrettMessages}
            isSendingBrettMessage={isSendingBrettMessage}
            isLoadingMoreBrettMessages={isLoadingMoreBrettMessages}
            brettTotalCount={brettTotalCount}
            onRetryExtraction={onRetryExtraction}
          />
        ) : (
          <div className="flex-1 overflow-y-auto p-6 scrollbar-hide">
            <h2 className="text-2xl font-semibold text-white mb-6 leading-tight">
              {item.title}
            </h2>
          </div>
        )
      ) : isLoadingCalendarDetail ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 size={24} className="text-white/30 animate-spin" />
        </div>
      ) : calendarEventDetail ? (
        <CalendarEventDetailPanel
          detail={calendarEventDetail}
          onUpdateRsvp={onUpdateRsvp ?? (() => {})}
          onUpdateNotes={onUpdateCalendarNotes ?? (() => {})}
          brettMessages={calendarBrettMessages ?? []}
          brettTotalCount={calendarBrettTotalCount ?? 0}
          brettHasMore={calendarBrettHasMore ?? false}
          onSendBrettMessage={onSendCalendarBrettMessage ?? (() => {})}
          onLoadMoreBrettMessages={onLoadMoreCalendarBrettMessages ?? (() => {})}
          isSendingBrettMessage={isSendingCalendarBrettMessage ?? false}
          isLoadingMoreBrettMessages={isLoadingMoreCalendarBrettMessages ?? false}
        />
      ) : (
        <div className="flex-1 overflow-y-auto p-6 scrollbar-hide">
          <h2 className="text-2xl font-semibold text-white mb-6 leading-tight">
            {item.title}
          </h2>
        </div>
      )}
      </div>
    </>
  );
}
