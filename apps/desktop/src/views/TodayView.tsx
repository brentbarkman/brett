import React, { useState } from "react";
import {
  Omnibar,
  MorningBriefing,
  UpNextCard,
  FilterPills,
  ThingsList,
  ThingsEmptyState,
  CrossFade,
  TriagePopup,
} from "@brett/ui";
import type { Thing, CalendarEvent, NavList } from "@brett/types";
import {
  useActiveThings,
  useDoneThings,
  useCreateThing,
  useToggleThing,
} from "../api/things";
import { mockEvents, mockBriefingItems } from "../data/mockData";

interface TodayViewProps {
  lists: NavList[];
  onItemClick: (item: Thing | CalendarEvent) => void;
  onTriageOpen: (mode: "list-first" | "date-first", ids: string[]) => void;
  triagePopup: React.ReactNode | null;
}

export function TodayView({ lists, onItemClick, onTriageOpen, triagePopup }: TodayViewProps) {
  const [activeFilter, setActiveFilter] = useState("All");
  const [isBriefingVisible, setIsBriefingVisible] = useState(true);

  // Compute date boundaries for today view queries
  const now = new Date();
  const todayStart = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const dayOfWeek = todayStart.getUTCDay();
  const daysUntilSunday = dayOfWeek === 0 ? 7 : 7 - dayOfWeek;
  const endOfWeek = new Date(todayStart.getTime() + daysUntilSunday * 86400000);
  const dueBefore = endOfWeek.toISOString();
  const completedAfter = todayStart.toISOString();

  // Two explicit queries: active items due this week or earlier, done items from today
  const { data: activeThings = [], isLoading: activeLoading } = useActiveThings(dueBefore);
  const { data: doneThings = [], isLoading: doneLoading } = useDoneThings(completedAfter);
  const things = [...activeThings, ...doneThings];
  const thingsLoading = activeLoading || doneLoading;

  const createThing = useCreateThing();
  const toggleThing = useToggleThing();

  const handleToggle = (id: string) => {
    toggleThing.mutate(id);
  };

  const handleAddTask = (title: string, listId: string | null) => {
    // Tasks created in the today view default to due today
    const now = new Date();
    const todayISO = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())).toISOString();
    createThing.mutate(
      { type: "task", title, listId: listId ?? undefined, dueDate: todayISO, dueDatePrecision: "day" },
      { onError: (err) => console.error("Failed to create thing:", err) }
    );
  };

  const handleAddContent = (url: string, title: string, listId: string | null) => {
    createThing.mutate(
      { type: "content", title, sourceUrl: url, listId: listId ?? undefined },
      { onError: (err) => console.error("Failed to create thing:", err) }
    );
  };

  // Server provides the right date range; client just applies type filter
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
      onItemClick={onItemClick}
      onToggle={handleToggle}
      onAdd={handleAddTask}
      onTriageOpen={onTriageOpen}
      header={<ThingsEmptyState activeFilter={activeFilter} hasThingsElsewhere allCompleted inline lists={lists} onAddTask={handleAddTask} onAddContent={handleAddContent} />}
    />
  ) : (
    <ThingsList things={filteredThings} lists={lists} onItemClick={onItemClick} onToggle={handleToggle} onAdd={handleAddTask} onTriageOpen={onTriageOpen} />
  );

  return (
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
          onClick={() => onItemClick(upNextEvent)}
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

      {triagePopup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          {triagePopup}
        </div>
      )}
    </>
  );
}
