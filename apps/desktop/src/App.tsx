import React, { useEffect, useState } from "react";
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
} from "@brett/ui";
import type { Thing, CalendarEvent } from "@brett/types";
import { useAuth } from "./auth/AuthContext";
import { useThings, useCreateThing, useToggleThing } from "./api/things";
import { useLists, useCreateList } from "./api/lists";
import { mockEvents, mockBriefingItems } from "./data/mockData";

export function App() {
  const { user } = useAuth();
  const [activeFilter, setActiveFilter] = useState("All");
  const [isBriefingVisible, setIsBriefingVisible] = useState(true);
  const [selectedItem, setSelectedItem] = useState<
    Thing | CalendarEvent | null
  >(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);

  const { data: things = [], isLoading: thingsLoading } = useThings();
  const { data: lists = [] } = useLists();
  const createThing = useCreateThing();
  const toggleThing = useToggleThing();
  const createList = useCreateList();

  // Apply dark mode to root
  useEffect(() => {
    document.documentElement.classList.add("dark");
  }, []);

  // Handle escape key to close detail panel
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsDetailOpen(false);
        setTimeout(() => setSelectedItem(null), 300);
      }
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, []);

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

  const ensureListThenCreate = (
    input: { type: string; title: string; sourceUrl?: string },
    listId: string | null,
  ) => {
    if (listId) {
      createThing.mutate(
        { ...input, listId },
        { onError: (err) => console.error("Failed to create thing:", err) }
      );
    } else {
      // No lists yet — auto-create "Inbox" then add the thing to it
      createList.mutate(
        { name: "Inbox", colorClass: "bg-blue-500" },
        {
          onSuccess: (newList) => {
            createThing.mutate(
              { ...input, listId: newList.id },
              { onError: (err) => console.error("Failed to create thing:", err) }
            );
          },
          onError: (err) => console.error("Failed to create list:", err),
        }
      );
    }
  };

  const handleAddTask = (title: string, listId: string | null) => {
    ensureListThenCreate({ type: "task", title }, listId);
  };

  const handleAddContent = (url: string, title: string, listId: string | null) => {
    ensureListThenCreate({ type: "content", title, sourceUrl: url }, listId);
  };

  // Filter things based on active pill
  const filteredThings = things.filter((thing) => {
    if (activeFilter === "All") return true;
    if (activeFilter === "Tasks") return thing.type === "task";
    if (activeFilter === "Content") return thing.type === "content";
    return true;
  });

  const upNextEvent = mockEvents.find((e) => e.id === "e2");

  // Determine which state the things area is in for cross-fade
  // "list" and "all-completed" both render ThingsList (header animates internally),
  // so they share a key — CrossFade only fires between fundamentally different views.
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

  return (
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
        <LeftNav isCollapsed={isDetailOpen} lists={lists} user={user} incompleteCount={things.filter(t => !t.isCompleted).length} />

        {/* Center Column: Main Today View */}
        <main className="flex-1 min-w-0 overflow-y-auto scrollbar-hide py-2">
          <div className="max-w-3xl mx-auto w-full space-y-4">
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
    </div>
  );
}
