import React from "react";
import { ArrowLeft, Loader2 } from "lucide-react";
import type {
  Thing,
  CalendarEventDisplay,
  ThingDetail,
  CalendarEventDetailResponse,
  CalendarRsvpStatus,
  DueDatePrecision,
  ReminderType,
  RecurrenceType,
} from "@brett/types";
import { TaskDetailPanel } from "./TaskDetailPanel";
import { ContentDetailPanel } from "./ContentDetailPanel";
import { CalendarEventDetailPanel } from "./CalendarEventDetailPanel";
import type { BrettThreadMessage } from "./BrettThread";

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
  // Content extraction
  onRetryExtraction?: () => void;
  // Calendar event callbacks
  calendarEventDetail?: CalendarEventDetailResponse | null;
  isLoadingCalendarDetail?: boolean;
  onUpdateRsvp?: (status: CalendarRsvpStatus, comment?: string) => void;
  onUpdateCalendarNotes?: (content: string) => void;
  calendarBrettMessages?: BrettThreadMessage[];
  calendarBrettTotalCount?: number;
  calendarBrettHasMore?: boolean;
  onSendCalendarBrettMessage?: (content: string) => void;
  onLoadMoreCalendarBrettMessages?: () => void;
  isSendingCalendarBrettMessage?: boolean;
  isCalendarBrettStreaming?: boolean;
  isLoadingMoreCalendarBrettMessages?: boolean;
  calendarBrettAiConfigured?: boolean;
  // Meeting notes
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
  onNavigateToCalendarEvent?: (calendarEventId: string) => void;
  onNavigateToScout?: (scoutId: string) => void;
  onScoutFeedback?: (scoutId: string, findingId: string, useful: boolean | null) => void;
  onBack?: () => void;
  canGoBack?: boolean;
  onItemClick?: (id: string) => void;
  onEventClick?: (eventId: string) => void;
  onNavigate?: (path: string) => void;
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
  isBrettStreaming,
  isLoadingMoreBrettMessages,
  brettTotalCount,
  brettAiConfigured,
  onOpenSettings,
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
  isCalendarBrettStreaming,
  isLoadingMoreCalendarBrettMessages,
  calendarBrettAiConfigured,
  meetingNote,
  onToggleActionItem,
  onSelectActionItem,
  onReprocessActionItems,
  isReprocessing,
  onNavigateToCalendarEvent,
  onNavigateToScout,
  onScoutFeedback,
  onBack,
  canGoBack,
  onItemClick,
  onEventClick,
  onNavigate,
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
      {/* Back button */}
      {canGoBack && onBack && (
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 px-4 py-2 text-xs text-white/40 hover:text-white/70 transition-colors border-b border-white/5 flex-shrink-0"
        >
          <ArrowLeft className="w-3 h-3" />
          Back
        </button>
      )}

      {/* Content */}
      {isTask ? (
        isLoadingDetail ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 size={24} className="text-white/30 animate-spin" />
          </div>
        ) : detail ? (
          <TaskDetailPanel
            detail={detail}
            onClose={onClose}
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
            isBrettStreaming={isBrettStreaming}
            isLoadingMoreBrettMessages={isLoadingMoreBrettMessages}
            brettTotalCount={brettTotalCount}
            brettAiConfigured={brettAiConfigured}
            onOpenSettings={onOpenSettings}
            onNavigateToCalendarEvent={onNavigateToCalendarEvent}
            onNavigateToScout={onNavigateToScout}
            onScoutFeedback={onScoutFeedback}
            onItemClick={onItemClick}
            onEventClick={onEventClick}
            onNavigate={onNavigate}
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
            onClose={onClose}
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
            isBrettStreaming={isBrettStreaming}
            isLoadingMoreBrettMessages={isLoadingMoreBrettMessages}
            brettTotalCount={brettTotalCount}
            brettAiConfigured={brettAiConfigured}
            onOpenSettings={onOpenSettings}
            onRetryExtraction={onRetryExtraction}
            onItemClick={onItemClick}
            onEventClick={onEventClick}
            onNavigateToScout={onNavigateToScout}
            onScoutFeedback={onScoutFeedback}
            onNavigate={onNavigate}
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
          onClose={onClose}
          onUpdateRsvp={onUpdateRsvp ?? (() => {})}
          onUpdateNotes={onUpdateCalendarNotes ?? (() => {})}
          brettMessages={calendarBrettMessages ?? []}
          brettTotalCount={calendarBrettTotalCount ?? 0}
          brettHasMore={calendarBrettHasMore ?? false}
          onSendBrettMessage={onSendCalendarBrettMessage ?? (() => {})}
          onLoadMoreBrettMessages={onLoadMoreCalendarBrettMessages ?? (() => {})}
          isSendingBrettMessage={isSendingCalendarBrettMessage ?? false}
          isBrettStreaming={isCalendarBrettStreaming}
          isLoadingMoreBrettMessages={isLoadingMoreCalendarBrettMessages ?? false}
          brettAiConfigured={calendarBrettAiConfigured}
          onOpenSettings={onOpenSettings}
          meetingNote={meetingNote}
          onToggleActionItem={onToggleActionItem}
          onSelectActionItem={onSelectActionItem}
          onReprocessActionItems={onReprocessActionItems}
          isReprocessing={isReprocessing}
          onItemClick={onItemClick}
          onNavigate={onNavigate}
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
