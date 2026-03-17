import React from "react";
import { X, Calendar, MapPin, Users, Loader2 } from "lucide-react";
import type {
  Thing,
  CalendarEvent,
  ThingDetail,
  DueDatePrecision,
  ReminderType,
  RecurrenceType,
  BrettMessage,
} from "@brett/types";
import { TaskDetailPanel } from "./TaskDetailPanel";

interface DetailPanelProps {
  isOpen: boolean;
  item: Thing | CalendarEvent | null;
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
}: DetailPanelProps) {
  if (!item) return null;
  const isTask = !("startTime" in item);

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
          shadow-2xl z-50 transform transition-transform duration-300 ease-out flex flex-col
          ${isOpen ? "translate-x-0" : "translate-x-full"}
        `}
      >
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-white/10">
        <span className="font-mono text-xs uppercase tracking-wider text-white/40">
          {isTask ? "Detail" : "Event"}
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
          />
        ) : (
          <div className="flex-1 overflow-y-auto p-6 scrollbar-hide">
            <h2 className="text-2xl font-semibold text-white mb-6 leading-tight">
              {item.title}
            </h2>
          </div>
        )
      ) : (
        <div className="flex-1 overflow-y-auto p-6 scrollbar-hide">
          <h2 className="text-2xl font-semibold text-white mb-6 leading-tight">
            {item.title}
          </h2>

          {/* Brett's Take */}
          {item.brettObservation && (
            <div className="mb-8 bg-blue-500/10 border-l-2 border-blue-500 p-4 rounded-r-lg">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                <span className="text-xs font-mono uppercase text-blue-400 font-semibold">
                  Brett's Take
                </span>
              </div>
              <p className="text-sm italic text-blue-300/90 leading-relaxed">
                &ldquo;{item.brettObservation}&rdquo;
              </p>
            </div>
          )}

          {/* Event Specific Details */}
          <div className="space-y-6">
            <div className="space-y-3">
              <div className="flex items-center gap-3 text-sm text-white/80">
                <Calendar size={16} className="text-white/40" />
                <span>
                  Today, {(item as CalendarEvent).startTime} -{" "}
                  {(item as CalendarEvent).endTime}
                </span>
              </div>
              {(item as CalendarEvent).location && (
                <div className="flex items-center gap-3 text-sm text-white/80">
                  <MapPin size={16} className="text-white/40" />
                  <span>{(item as CalendarEvent).location}</span>
                </div>
              )}
            </div>

            {(item as CalendarEvent).attendees && (
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <Users size={14} className="text-white/40" />
                  <span className="text-xs font-medium text-white/50 uppercase tracking-wider">
                    Attendees
                  </span>
                </div>
                <div className="flex flex-col gap-2">
                  {(item as CalendarEvent).attendees!.map((attendee, idx) => (
                    <div
                      key={idx}
                      className="flex items-center gap-3 bg-white/5 p-2 rounded-lg border border-white/5"
                    >
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center text-xs font-bold text-white shadow-inner">
                        {attendee.initials}
                      </div>
                      <span className="text-sm text-white/90">
                        {attendee.name}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      </div>
    </>
  );
}
