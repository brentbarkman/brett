import React, { useEffect, useState, useCallback } from "react";
import { Routes, Route, useNavigate, useLocation } from "react-router-dom";
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
import type { Thing, CalendarEvent } from "@brett/types";
import { useAuth } from "./auth/AuthContext";
import {
  useCreateThing,
  useToggleThing,
  useInboxThings,
  useBulkUpdateThings,
} from "./api/things";
import { useLists, useCreateList, useUpdateList, useDeleteList, useReorderLists, useArchiveList, useUnarchiveList, useArchivedLists } from "./api/lists";
import { mockEvents } from "./data/mockData";
import { SettingsPage } from "./settings/SettingsPage";
import { TodayView } from "./views/TodayView";
import { ListView } from "./views/ListView";

function MainLayout({ children, onEventClick }: { children: React.ReactNode; onEventClick: (e: any) => void }) {
  return (
    <>
      <main className="flex-1 min-w-0 overflow-y-auto scrollbar-hide py-2">
        <div className="max-w-3xl mx-auto w-full space-y-4">
          {children}
        </div>
      </main>
      <div className="w-[300px] flex-shrink-0 py-2">
        <CalendarTimeline events={mockEvents} onEventClick={onEventClick} />
      </div>
    </>
  );
}

export function App() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [selectedItem, setSelectedItem] = useState<
    Thing | CalendarEvent | null
  >(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);

  // Triage popup state
  const [triageState, setTriageState] = useState<{
    mode: "list-first" | "date-first";
    ids: string[];
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

  const { data: lists = [] } = useLists();
  const createList = useCreateList();
  const updateList = useUpdateList();
  const deleteList = useDeleteList();
  const reorderLists = useReorderLists();
  const archiveList = useArchiveList();
  const unarchiveList = useUnarchiveList();
  const { data: archivedLists = [] } = useArchivedLists();
  const createThing = useCreateThing();
  const toggleThing = useToggleThing();
  const bulkUpdate = useBulkUpdateThings();

  // Inbox data — fetch with hidden when inbox is active
  const { data: inboxData } = useInboxThings(location.pathname === "/inbox");

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

  const handleItemClick = (item: Thing | CalendarEvent) => {
    setSelectedItem(item);
    setIsDetailOpen(true);
  };

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

  const handleTriageOpen = (mode: "list-first" | "date-first", ids: string[]) => {
    setTriageState({ mode, ids });
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
      if (location.pathname === `/lists/${id}`) navigate("/today");
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
            currentPath={location.pathname}
            navigate={navigate}
            inboxCount={inboxCount}
            onCreateList={(name) => createList.mutate({ name })}
            onRenameList={(id, name) => updateList.mutate({ id, name })}
            onDeleteList={(id) => {
              const list = [...lists, ...archivedLists].find((l) => l.id === id);
              if (list && list.count > 0) {
                setDeleteListConfirm({ id, name: list.name, count: list.count });
              } else {
                deleteList.mutate(id);
                if (location.pathname === `/lists/${id}`) {
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
            <Route path="/today" element={
              <MainLayout onEventClick={handleItemClick}>
                <TodayView
                  lists={lists}
                  onItemClick={handleItemClick}
                  onTriageOpen={handleTriageOpen}
                  triagePopup={triageState ? (
                    <TriagePopup mode={triageState.mode} lists={lists} onConfirm={handleTriageConfirm} onCancel={handleTriageCancel} />
                  ) : null}
                />
              </MainLayout>
            } />
            <Route path="/inbox" element={
              <MainLayout onEventClick={handleItemClick}>
                <InboxView
                  things={inboxData?.visible ?? []}
                  hiddenCount={inboxData?.hiddenCount ?? 0}
                  hiddenThings={inboxData?.hidden}
                  lists={lists}
                  onItemClick={handleItemClick}
                  onToggle={handleToggle}
                  onArchive={handleInboxArchive}
                  onAdd={handleInboxAdd}
                  onTriage={handleInboxTriage}
                  onTriageOpen={handleTriageOpen}
                  triagePopup={triageState ? (
                    <TriagePopup mode={triageState.mode} lists={lists} onConfirm={handleTriageConfirm} onCancel={handleTriageCancel} />
                  ) : undefined}
                />
              </MainLayout>
            } />
            <Route path="/lists/:id" element={
              <MainLayout onEventClick={handleItemClick}>
                <ListView lists={lists} archivedLists={archivedLists} onItemClick={handleItemClick} onArchiveList={handleArchiveList} />
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
              if (location.pathname === `/lists/${archiveListConfirm.id}`) navigate("/today");
              setArchiveListConfirm(null);
            }}
            onCancel={() => setArchiveListConfirm(null)}
          />
        )}
      </div>
    </DndContext>
  );
}
