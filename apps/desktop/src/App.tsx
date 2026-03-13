import React, { useEffect, useState, useCallback } from "react";
import {
  DndContext,
  DragOverlay,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  LeftNav,
  Omnibar,
  MorningBriefing,
  UpNextCard,
  FilterPills,
  ThingsList,
  CalendarTimeline,
  DetailPanel,
  ThingsEmptyState,
  CrossFade,
  InboxView,
  TriagePopup,
  InboxDragOverlay,
} from "@brett/ui";
import type { Thing, CalendarEvent } from "@brett/types";
import { useAuth } from "./auth/AuthContext";
import {
  useThings,
  useCreateThing,
  useToggleThing,
  useInboxThings,
  useBulkUpdateThings,
} from "./api/things";
import { useLists } from "./api/lists";
import { mockEvents, mockBriefingItems } from "./data/mockData";

type ActiveView = "today" | "inbox";

export function App() {
  const { user } = useAuth();
  const [activeView, setActiveView] = useState<ActiveView>("today");
  const [activeFilter, setActiveFilter] = useState("All");
  const [isBriefingVisible, setIsBriefingVisible] = useState(true);
  const [selectedItem, setSelectedItem] = useState<
    Thing | CalendarEvent | null
  >(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);

  // Triage popup state
  const [triageState, setTriageState] = useState<{
    mode: "list-first" | "date-first";
    ids: string[];
  } | null>(null);

  // Drag state
  const [activeDrag, setActiveDrag] = useState<{
    id: string;
    title: string;
    count: number;
  } | null>(null);

  const { data: things = [], isLoading: thingsLoading } = useThings();
  const { data: lists = [] } = useLists();
  const createThing = useCreateThing();
  const toggleThing = useToggleThing();
  const bulkUpdate = useBulkUpdateThings();

  // Inbox data — fetch with hidden when inbox is active
  const { data: inboxData } = useInboxThings(activeView === "inbox");

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

  const handleAddTask = (title: string, listId: string | null) => {
    createThing.mutate(
      { type: "task", title, listId: listId ?? undefined },
      { onError: (err) => console.error("Failed to create thing:", err) }
    );
  };

  const handleAddContent = (url: string, title: string, listId: string | null) => {
    createThing.mutate(
      { type: "content", title, sourceUrl: url, listId: listId ?? undefined },
      { onError: (err) => console.error("Failed to create thing:", err) }
    );
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
    updates: { listId?: string | null; dueDate?: string | null }
  ) => {
    bulkUpdate.mutate({ ids, updates });
  };

  const handleTriageOpen = (mode: "list-first" | "date-first", ids: string[]) => {
    setTriageState({ mode, ids });
  };

  const handleTriageConfirm = (updates: {
    listId?: string | null;
    dueDate?: string | null;
  }) => {
    if (triageState) {
      handleInboxTriage(triageState.ids, updates);
    }
    setTriageState(null);
  };

  const handleTriageCancel = () => {
    setTriageState(null);
  };

  const handleNavClick = (view: string) => {
    if (view === "today" || view === "inbox") {
      setActiveView(view);
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
      }
    },
    [inboxData]
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveDrag(null);
      const { active, over } = event;
      if (!over) return;

      const overData = over.data.current;
      if (overData?.type === "list") {
        const listId = overData.listId;
        const activeData = active.data.current;
        const itemIds: string[] =
          activeData?.selectedIds ?? [active.id as string];
        bulkUpdate.mutate({ ids: itemIds, updates: { listId } });
      }
    },
    [bulkUpdate]
  );

  // Filter things based on active pill
  const filteredThings = things.filter((thing) => {
    if (activeFilter === "All") return true;
    if (activeFilter === "Tasks") return thing.type === "task";
    if (activeFilter === "Content") return thing.type === "content";
    return true;
  });

  const upNextEvent = mockEvents.find((e) => e.id === "e2");

  // Determine which state the things area is in for cross-fade
  const allCompleted = filteredThings.length > 0 && filteredThings.every((t) => t.isCompleted);
  const isEmpty = filteredThings.length === 0;
  const thingsStateKey = thingsLoading
    ? "loading"
    : isEmpty
      ? "empty"
      : "has-things";

  const thingsContent = thingsLoading ? (
    <div className="bg-black/30 backdrop-blur-xl rounded-xl border border-white/10 p-8">
      <div className="text-center text-white/40 text-sm">
        Loading...
      </div>
    </div>
  ) : isEmpty ? (
    <ThingsEmptyState activeFilter={activeFilter} hasThingsElsewhere={things.length > 0} allCompleted={false} lists={lists} onAddTask={handleAddTask} onAddContent={handleAddContent} />
  ) : allCompleted ? (
    <ThingsList
      things={filteredThings}
      lists={lists}
      onItemClick={handleItemClick}
      onToggle={handleToggle}
      onAdd={handleAddTask}
      header={<ThingsEmptyState activeFilter={activeFilter} hasThingsElsewhere allCompleted inline lists={lists} onAddTask={handleAddTask} onAddContent={handleAddContent} />}
    />
  ) : (
    <ThingsList things={filteredThings} lists={lists} onItemClick={handleItemClick} onToggle={handleToggle} onAdd={handleAddTask} />
  );

  const inboxCount = inboxData?.visible.length ?? 0;

  return (
    <DndContext onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
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
            incompleteCount={things.filter(t => !t.isCompleted).length}
            activeView={activeView}
            onNavClick={handleNavClick}
            inboxCount={inboxCount}
          />

          {/* Center Column */}
          <main className="flex-1 min-w-0 overflow-y-auto scrollbar-hide py-2">
            <div className="max-w-3xl mx-auto w-full space-y-4">
              {activeView === "inbox" ? (
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
                  triagePopup={
                    triageState ? (
                      <TriagePopup
                        mode={triageState.mode}
                        lists={lists}
                        onConfirm={handleTriageConfirm}
                        onCancel={handleTriageCancel}
                      />
                    ) : undefined
                  }
                />
              ) : (
                <>
                  <Omnibar />

                  {isBriefingVisible && (
                    <MorningBriefing
                      items={mockBriefingItems}
                      onDismiss={() => setIsBriefingVisible(false)}
                    />
                  )}

                  {upNextEvent && (
                    <UpNextCard
                      event={upNextEvent}
                      onClick={() => handleItemClick(upNextEvent)}
                    />
                  )}

                  <div className="bg-black/30 backdrop-blur-xl rounded-xl border border-white/10 px-4 py-3">
                    <FilterPills
                      activeFilter={activeFilter}
                      onSelectFilter={setActiveFilter}
                    />
                  </div>

                  <CrossFade stateKey={thingsStateKey} exitMs={180} enterMs={280}>
                    {thingsContent}
                  </CrossFade>
                </>
              )}
            </div>
          </main>

          {/* Right Column: Calendar */}
          <div className="w-[300px] flex-shrink-0 py-2">
            <CalendarTimeline
              events={mockEvents}
              onEventClick={handleItemClick}
            />
          </div>
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
      </div>
    </DndContext>
  );
}
