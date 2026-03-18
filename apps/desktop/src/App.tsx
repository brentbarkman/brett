import React, { useEffect, useState, useCallback, useMemo } from "react";
import { Routes, Route, Navigate, useNavigate, useLocation } from "react-router-dom";
import { slugify } from "@brett/utils";
import { getEndOfWeekUTC } from "@brett/business";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import { arrayMove } from "@dnd-kit/sortable";
import {
  LeftNav,
  CalendarTimeline,
  DetailPanel,
  InboxView,
  TriagePopup,
  InboxDragOverlay,
  ConfirmDialog,
} from "@brett/ui";
import type { Thing, CalendarEventDisplay, CalendarEventRecord, DueDatePrecision, ReminderType, RecurrenceType } from "@brett/types";
import { useAuth } from "./auth/AuthContext";
import {
  useActiveThings,
  useUpcomingThings,
  useCreateThing,
  useToggleThing,
  useInboxThings,
  useBulkUpdateThings,
  useThingDetail,
  useDeleteThing,
  useUpdateThing,
  useThings,
} from "./api/things";
import { useLists, useCreateList, useUpdateList, useDeleteList, useReorderLists, useArchiveList, useUnarchiveList, useArchivedLists } from "./api/lists";
import { useUploadAttachment, useDeleteAttachment } from "./api/attachments";
import { useBrettMessages, useSendBrettMessage } from "./api/brett";
import { useCreateLink, useDeleteLink } from "./api/links";
import {
  useCalendarEvents,
  useCalendarEventDetail,
  useUpdateRsvp,
  useUpdateCalendarEventNotes,
  useCalendarEventBrettMessages,
  useSendCalendarBrettMessage,
} from "./api/calendar";
import { useEventStream } from "./api/sse";
import { SettingsPage } from "./settings/SettingsPage";
import { TodayView } from "./views/TodayView";
import { ListView } from "./views/ListView";
import { UpcomingView } from "./views/UpcomingView";
import { NotFoundView } from "./views/NotFoundView";
import CalendarPage from "./pages/CalendarPage";

function MainLayout({ children, onEventClick, calendarEvents, isLoadingCalendar }: {
  children: React.ReactNode;
  onEventClick: (e: any) => void;
  calendarEvents: CalendarEventDisplay[];
  isLoadingCalendar?: boolean;
}) {
  return (
    <>
      <main className="flex-1 min-w-0 overflow-y-auto scrollbar-hide py-2">
        <div className="max-w-3xl mx-auto w-full space-y-4">
          {children}
        </div>
      </main>
      <div className="w-[300px] flex-shrink-0 py-2">
        <CalendarTimeline events={calendarEvents} onEventClick={onEventClick} isLoading={isLoadingCalendar} />
      </div>
    </>
  );
}

/** Map CalendarEventRecord to CalendarEventDisplay for the sidebar timeline */
function recordToDisplay(r: CalendarEventRecord): CalendarEventDisplay {
  const defaultColor = {
    bg: "rgba(59, 130, 246, 0.12)",
    border: "rgba(59, 130, 246, 0.25)",
    text: "rgb(147, 197, 253)",
    name: "blue",
  };
  return {
    id: r.id,
    title: r.title,
    startTime: r.startTime,
    endTime: r.endTime,
    durationMinutes: Math.max((new Date(r.endTime).getTime() - new Date(r.startTime).getTime()) / 60000, 0),
    color: defaultColor,
    location: r.location ?? undefined,
    attendees: r.attendees?.map((a) => ({
      name: a.name,
      initials: a.name.split(" ").map((n) => n[0]).join("").toUpperCase(),
      email: a.email,
      responseStatus: a.responseStatus,
    })),
    hasBrettContext: false,
    meetingLink: r.meetingLink ?? undefined,
    isAllDay: r.isAllDay,
    myResponseStatus: r.myResponseStatus,
    description: r.description ?? undefined,
    googleEventId: r.googleEventId,
  };
}

export function App() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // Initialize SSE for real-time updates
  useEventStream();
  const [selectedItem, setSelectedItem] = useState<
    Thing | CalendarEventDisplay | null
  >(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);

  // Triage popup state
  const [triageState, setTriageState] = useState<{
    mode: "list-first" | "date-first";
    ids: string[];
    currentListId?: string | null;
    currentDueDate?: string | null;
    currentDueDatePrecision?: "day" | "week" | null;
  } | null>(null);

  // Delete list confirmation state
  const [deleteListConfirm, setDeleteListConfirm] = useState<{
    id: string;
    name: string;
    count: number;
  } | null>(null);

  // Archive list confirmation state
  const [archiveListConfirm, setArchiveListConfirm] = useState<{
    id: string;
    name: string;
    incompleteCount: number;
  } | null>(null);

  // Drag: require 8px movement before activating — clicks open detail, drag needs movement
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    })
  );

  // Drag state
  const [activeDrag, setActiveDrag] = useState<{
    id: string;
    title: string;
    count: number;
  } | null>(null);

  const listsQuery = useLists();
  const lists = listsQuery.data ?? [];
  const listsFetching = listsQuery.isFetching || !listsQuery.isFetched;
  const createList = useCreateList();
  const updateList = useUpdateList();
  const deleteList = useDeleteList();
  const reorderLists = useReorderLists();
  const archiveList = useArchiveList();
  const unarchiveList = useUnarchiveList();
  const { data: archivedLists = [] } = useArchivedLists();
  const createThing = useCreateThing();
  const toggleThing = useToggleThing();
  const updateThing = useUpdateThing();
  const deleteThing = useDeleteThing();
  const bulkUpdate = useBulkUpdateThings();

  // Attachment hooks
  const uploadAttachment = useUploadAttachment();
  const deleteAttachment = useDeleteAttachment();

  // Link hooks
  const createLink = useCreateLink();
  const deleteLink = useDeleteLink();

  // Brett thread hooks
  const sendBrettMessage = useSendBrettMessage();

  // Today's calendar events for sidebar timeline
  const todayStr = useMemo(() => new Date().toISOString().split("T")[0], []);
  const { data: todayCalendarData, isLoading: isLoadingTodayCalendar } = useCalendarEvents({ date: todayStr });
  const todayCalendarEvents: CalendarEventDisplay[] = useMemo(
    () => (todayCalendarData?.events ?? []).filter((e) => !e.isAllDay).map(recordToDisplay),
    [todayCalendarData],
  );

  // Fetch detail when panel is open and item is a task (not a CalendarEvent)
  const selectedId = selectedItem?.id ?? null;
  const isTaskSelected = selectedItem ? !("googleEventId" in selectedItem) : false;
  const isCalendarSelected = selectedItem ? "googleEventId" in selectedItem : false;
  const { data: thingDetail, isLoading: isLoadingDetail } = useThingDetail(
    isDetailOpen && isTaskSelected ? selectedId : null,
  );

  // Brett messages for selected item
  const brett = useBrettMessages(
    isDetailOpen && isTaskSelected ? selectedId : null,
  );

  // Calendar event detail panel hooks
  const { data: calendarEventDetail, isLoading: isLoadingCalendarDetail } = useCalendarEventDetail(
    isDetailOpen && isCalendarSelected ? selectedId : null,
  );
  const updateRsvp = useUpdateRsvp();
  const updateCalendarNotes = useUpdateCalendarEventNotes();
  const calendarBrett = useCalendarEventBrettMessages(
    isDetailOpen && isCalendarSelected ? selectedId : null,
  );
  const sendCalendarBrettMessage = useSendCalendarBrettMessage();

  // Active things for link search
  const { data: allActiveThings = [] } = useThings({ status: "active" });

  // Search items for linked items
  const handleSearchItems = useCallback(
    async (query: string) => {
      const q = query.toLowerCase();
      return allActiveThings.filter(
        (t) =>
          t.id !== selectedId && t.title.toLowerCase().includes(q),
      );
    },
    [allActiveThings, selectedId],
  );

  // Today badge count — active items due this week or earlier
  const endOfWeekISO = useMemo(() => getEndOfWeekUTC().toISOString(), []);
  const { data: activeThingsForCount = [] } = useActiveThings(endOfWeekISO);

  // Upcoming badge count
  const { data: upcomingThings = [] } = useUpcomingThings();

  // Inbox data
  const { data: inboxData } = useInboxThings();

  // Apply dark mode to root
  useEffect(() => {
    document.documentElement.classList.add("dark");
  }, []);

  // Handle escape key to close detail panel
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (triageState) {
          setTriageState(null);
          return;
        }
        setIsDetailOpen(false);
        setTimeout(() => setSelectedItem(null), 300);
      }
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [triageState]);

  const handleItemClick = (item: Thing | CalendarEventDisplay) => {
    setSelectedItem(item);
    setIsDetailOpen(true);
  };

  // Adapter for CalendarPage which passes CalendarEventRecord
  const handleCalendarEventClick = useCallback((event: CalendarEventRecord) => {
    handleItemClick(recordToDisplay(event));
  }, []);

  // Update panel when keyboard nav changes focus (only if panel is open)
  const handleFocusChange = useCallback((thing: Thing) => {
    if (isDetailOpen) {
      setSelectedItem(thing);
    }
  }, [isDetailOpen]);

  const handleCloseDetail = () => {
    setIsDetailOpen(false);
    setTimeout(() => setSelectedItem(null), 300);
  };

  const handleToggle = (id: string) => {
    toggleThing.mutate(id);
  };

  // Inbox-specific handlers
  const handleInboxAdd = (title: string) => {
    createThing.mutate(
      { type: "task", title },
      { onError: (err) => console.error("Failed to create thing:", err) }
    );
  };

  const handleInboxArchive = (ids: string[]) => {
    bulkUpdate.mutate({ ids, updates: { status: "archived" } });
  };

  const handleInboxTriage = (
    ids: string[],
    updates: { listId?: string | null; dueDate?: string | null; dueDatePrecision?: "day" | "week" | null }
  ) => {
    bulkUpdate.mutate({ ids, updates });
  };

  const handleUpdateThing = (updates: Record<string, unknown>) => {
    if (selectedId) {
      updateThing.mutate({ id: selectedId, ...updates });
    }
  };

  const handleDeleteThing = (id: string) => {
    deleteThing.mutate(id);
    handleCloseDetail();
  };

  const handleDuplicateThing = (id: string) => {
    // Duplicate: create a new thing with the same title + list
    const item = selectedItem as Thing | null;
    if (item) {
      createThing.mutate({ type: "task", title: `${item.title} (copy)`, listId: item.listId ?? undefined });
    }
  };

  const handleMoveToList = (id: string) => {
    // Open triage in list-first mode for moving
    const item = selectedItem as Thing | null;
    if (item) {
      handleTriageOpen("list-first", [id], { listId: item.listId, dueDate: item.dueDate ?? undefined, dueDatePrecision: item.dueDatePrecision });
    }
  };

  const handleTriageOpen = (mode: "list-first" | "date-first", ids: string[], thing?: { listId?: string | null; dueDate?: string; dueDatePrecision?: "day" | "week" | null }) => {
    setTriageState({ mode, ids, currentListId: thing?.listId, currentDueDate: thing?.dueDate, currentDueDatePrecision: thing?.dueDatePrecision });
  };

  const handleTriageConfirm = (updates: {
    listId?: string | null;
    dueDate?: string | null;
    dueDatePrecision?: "day" | "week" | null;
  }) => {
    if (triageState) {
      handleInboxTriage(triageState.ids, updates);
    }
    setTriageState(null);
  };

  const handleTriageCancel = () => {
    setTriageState(null);
  };

  const handleArchiveList = (id: string, knownIncompleteCount?: number) => {
    const list = [...lists, ...archivedLists].find((l) => l.id === id);
    if (!list) return;
    const incompleteCount = knownIncompleteCount ?? (list.count - list.completedCount);
    if (incompleteCount > 0) {
      setArchiveListConfirm({ id, name: list.name, incompleteCount });
    } else {
      archiveList.mutate(id);
      if (location.pathname === `/lists/${slugify(list.name)}`) navigate("/today");
    }
  };

  // DnD handlers
  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const data = event.active.data.current;
      if (data?.type === "inbox-item") {
        const ids: string[] = data.selectedIds ?? [data.thingId];
        const thing = inboxData?.visible.find((t) => t.id === data.thingId);
        setActiveDrag({
          id: data.thingId,
          title: thing?.title ?? "Item",
          count: ids.length,
        });
      } else if (data?.type === "thing-card") {
        setActiveDrag({
          id: data.thingId,
          title: data.title ?? "Item",
          count: 1,
        });
      }
    },
    [inboxData]
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveDrag(null);
      const { active, over } = event;
      if (!over) return;

      const activeData = active.data.current;
      const overData = over.data.current;

      // Handle list reordering (list dragged onto another list)
      if (activeData?.type === "sortable-list" && overData?.type === "sortable-list") {
        if (active.id !== over.id) {
          const sortableIds = lists.map((l) => `sortable-list-${l.id}`);
          const oldIndex = sortableIds.indexOf(active.id as string);
          const newIndex = sortableIds.indexOf(over.id as string);
          if (oldIndex !== -1 && newIndex !== -1) {
            const reordered = arrayMove(lists, oldIndex, newIndex);
            reorderLists.mutate(reordered.map((l) => l.id));
          }
        }
        return;
      }

      // Handle item drop onto list (from inbox or today view)
      if (overData?.type === "sortable-list" || overData?.type === "list") {
        const listId = overData.listId;
        const itemIds: string[] =
          activeData?.selectedIds ?? [active.id as string];
        bulkUpdate.mutate({ ids: itemIds, updates: { listId } });
      }
    },
    [bulkUpdate, lists, reorderLists]
  );

  const inboxCount = inboxData?.visible.length ?? 0;

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="relative flex h-screen w-full overflow-hidden text-white font-sans bg-black">
        {/* Full-bleed Photographic Background */}
        <div
          className="absolute inset-0 z-0 bg-cover bg-center opacity-60"
          style={{
            backgroundImage:
              'url("https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=1920&q=80")',
          }}
        />

        {/* Vignette overlay for better text readability */}
        <div className="absolute inset-0 z-0 bg-gradient-to-b from-black/40 via-transparent to-black/60 pointer-events-none" />

        {/* Main Layout Shell */}
        <div className="relative z-10 flex w-full h-full gap-4 p-4 pl-0">
          {/* Left Column: Navigation */}
          <LeftNav
            isCollapsed={isDetailOpen}
            lists={lists}
            user={user}
            incompleteCount={activeThingsForCount.length}
            currentPath={location.pathname}
            navigate={navigate}
            upcomingCount={upcomingThings.length}
            inboxCount={inboxCount}
            onCreateList={(name) => createList.mutate({ name }, {
              onSuccess: () => navigate(`/lists/${slugify(name)}`),
            })}
            onRenameList={(id, name) => updateList.mutate({ id, name })}
            onDeleteList={(id) => {
              const list = [...lists, ...archivedLists].find((l) => l.id === id);
              if (list && list.count > 0) {
                setDeleteListConfirm({ id, name: list.name, count: list.count });
              } else {
                deleteList.mutate(id);
                if (list && location.pathname === `/lists/${slugify(list.name)}`) {
                  navigate("/today");
                }
              }
            }}
            onReorderLists={(ids) => reorderLists.mutate(ids)}
            archivedLists={archivedLists}
            onArchiveList={handleArchiveList}
            onUnarchiveList={(id) => unarchiveList.mutate(id)}
          />

          <Routes>
            <Route path="/settings" element={<SettingsPage onBack={() => navigate("/today")} />} />
            <Route path="/calendar" element={<CalendarPage onEventClick={handleCalendarEventClick} />} />
            <Route path="/today" element={
              <MainLayout onEventClick={handleItemClick} calendarEvents={todayCalendarEvents} isLoadingCalendar={isLoadingTodayCalendar}>
                <TodayView
                  lists={lists}
                  onItemClick={handleItemClick}
                  onTriageOpen={handleTriageOpen}
                  onFocusChange={handleFocusChange}
                />
              </MainLayout>
            } />
            <Route path="/upcoming" element={
              <MainLayout onEventClick={handleItemClick} calendarEvents={todayCalendarEvents} isLoadingCalendar={isLoadingTodayCalendar}>
                <UpcomingView onItemClick={handleItemClick} onTriageOpen={handleTriageOpen} onFocusChange={handleFocusChange} />
              </MainLayout>
            } />
            <Route path="/inbox" element={
              <MainLayout onEventClick={handleItemClick} calendarEvents={todayCalendarEvents} isLoadingCalendar={isLoadingTodayCalendar}>
                <InboxView
                  things={inboxData?.visible ?? []}
                  lists={lists}
                  onItemClick={handleItemClick}
                  onToggle={handleToggle}
                  onArchive={handleInboxArchive}
                  onAdd={handleInboxAdd}
                  onTriage={handleInboxTriage}
                  onTriageOpen={handleTriageOpen}
                  onFocusChange={handleFocusChange}
                />
              </MainLayout>
            } />
            <Route path="/lists/:slug" element={
              <MainLayout onEventClick={handleItemClick} calendarEvents={todayCalendarEvents} isLoadingCalendar={isLoadingTodayCalendar}>
                <ListView lists={lists} archivedLists={archivedLists} listsFetching={listsFetching} onItemClick={handleItemClick} onArchiveList={handleArchiveList} onTriageOpen={handleTriageOpen} onFocusChange={handleFocusChange} />
              </MainLayout>
            } />
            <Route path="/" element={<Navigate to="/today" replace />} />
            <Route path="*" element={
              <MainLayout onEventClick={handleItemClick} calendarEvents={todayCalendarEvents} isLoadingCalendar={isLoadingTodayCalendar}>
                <NotFoundView />
              </MainLayout>
            } />
          </Routes>
        </div>

        {/* Sliding Detail Panel Overlay */}
        <DetailPanel
          isOpen={isDetailOpen}
          item={selectedItem}
          onClose={handleCloseDetail}
          onToggle={handleToggle}
          detail={thingDetail ?? null}
          isLoadingDetail={isLoadingDetail}
          onUpdate={handleUpdateThing}
          onDelete={handleDeleteThing}
          onDuplicate={handleDuplicateThing}
          onMoveToList={handleMoveToList}
          onUpdateDueDate={(dueDate, precision) => {
            if (selectedId) updateThing.mutate({ id: selectedId, dueDate, dueDatePrecision: precision });
          }}
          onUpdateReminder={(reminder) => {
            if (selectedId) updateThing.mutate({ id: selectedId, reminder });
          }}
          onUpdateRecurrence={(recurrence) => {
            if (selectedId) updateThing.mutate({ id: selectedId, recurrence });
          }}
          onUpdateNotes={(notes) => {
            if (selectedId) updateThing.mutate({ id: selectedId, notes });
          }}
          onUploadAttachment={(file) => {
            if (selectedId) uploadAttachment.mutate({ itemId: selectedId, file });
          }}
          onDeleteAttachment={(attachmentId) => {
            if (selectedId) deleteAttachment.mutate({ itemId: selectedId, attachmentId });
          }}
          isUploadingAttachment={uploadAttachment.isPending}
          onAddLink={(toItemId, toItemType) => {
            if (selectedId) createLink.mutate({ itemId: selectedId, toItemId, toItemType });
          }}
          onRemoveLink={(linkId) => {
            if (selectedId) deleteLink.mutate({ itemId: selectedId, linkId });
          }}
          searchItems={handleSearchItems}
          brettMessages={brett.messages}
          brettHasMore={brett.hasMore}
          onSendBrettMessage={(content) => {
            if (selectedId) sendBrettMessage.mutate({ itemId: selectedId, content });
          }}
          onLoadMoreBrettMessages={brett.loadMore}
          isSendingBrettMessage={sendBrettMessage.isPending}
          isLoadingMoreBrettMessages={brett.isLoadingMore}
          brettTotalCount={brett.totalCount}
          calendarEventDetail={calendarEventDetail ?? null}
          isLoadingCalendarDetail={isLoadingCalendarDetail}
          onUpdateRsvp={(status, comment) => {
            if (selectedId) updateRsvp.mutate({ eventId: selectedId, status, comment });
          }}
          onUpdateCalendarNotes={(content) => {
            if (selectedId) updateCalendarNotes.mutate({ eventId: selectedId, content });
          }}
          calendarBrettMessages={calendarBrett.messages}
          calendarBrettTotalCount={calendarBrett.totalCount}
          calendarBrettHasMore={calendarBrett.hasMore}
          onSendCalendarBrettMessage={(content) => {
            if (selectedId) sendCalendarBrettMessage.mutate({ eventId: selectedId, content });
          }}
          onLoadMoreCalendarBrettMessages={calendarBrett.loadMore}
          isSendingCalendarBrettMessage={sendCalendarBrettMessage.isPending}
          isLoadingMoreCalendarBrettMessages={calendarBrett.isLoadingMore}
        />

        {/* Drag overlay */}
        <DragOverlay dropAnimation={null}>
          {activeDrag && (
            <InboxDragOverlay
              title={activeDrag.title}
              count={activeDrag.count}
            />
          )}
        </DragOverlay>

        {/* Triage popup (global — works from any view) */}
        {triageState && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <TriagePopup
              mode={triageState.mode}
              lists={lists}
              currentListId={triageState.currentListId}
              currentDueDate={triageState.currentDueDate}
              currentDueDatePrecision={triageState.currentDueDatePrecision}
              onConfirm={handleTriageConfirm}
              onCancel={handleTriageCancel}
            />
          </div>
        )}

        {/* Delete list confirmation */}
        {deleteListConfirm && (
          <ConfirmDialog
            title={`Delete "${deleteListConfirm.name}"?`}
            description={`This will permanently delete ${deleteListConfirm.count} item${deleteListConfirm.count === 1 ? "" : "s"} in this list.`}
            confirmLabel="Delete"
            variant="danger"
            onConfirm={() => {
              deleteList.mutate(deleteListConfirm.id);
              setDeleteListConfirm(null);
            }}
            onCancel={() => setDeleteListConfirm(null)}
          />
        )}

        {/* Archive list confirmation */}
        {archiveListConfirm && (
          <ConfirmDialog
            title={`Archive "${archiveListConfirm.name}"?`}
            description={`${archiveListConfirm.incompleteCount} incomplete item${archiveListConfirm.incompleteCount === 1 ? "" : "s"} will be marked as done.`}
            confirmLabel="Archive"
            variant="default"
            onConfirm={() => {
              archiveList.mutate(archiveListConfirm.id);
              if (location.pathname === `/lists/${slugify(archiveListConfirm.name)}`) navigate("/today");
              setArchiveListConfirm(null);
            }}
            onCancel={() => setArchiveListConfirm(null)}
          />
        )}
      </div>
    </DndContext>
  );
}
