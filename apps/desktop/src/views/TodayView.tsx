import React, { useState, useMemo } from "react";
import {
  Omnibar,
  MorningBriefing,
  UpNextCard,
  FilterPills,
  ThingsList,
  ThingsEmptyState,
  CrossFade,
  TriagePopup,
  SkeletonListView,
} from "@brett/ui";
import type { Thing, CalendarEvent, NavList, FilterType } from "@brett/types";
import { getTodayUTC, getEndOfWeekUTC } from "@brett/business";
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
  onFocusChange?: (thing: Thing) => void;
}

export function TodayView({ lists, onItemClick, onTriageOpen, onFocusChange }: TodayViewProps) {
  const [activeFilter, setActiveFilter] = useState<FilterType>("All");
  const [isBriefingVisible, setIsBriefingVisible] = useState(true);

  // Stable date boundaries for the day — memoized to avoid re-fetches on re-render
  const { dueBefore, completedAfter } = useMemo(() => ({
    dueBefore: getEndOfWeekUTC().toISOString(),
    completedAfter: getTodayUTC().toISOString(),
  }), []);

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
    createThing.mutate(
      { type: "task", title, listId: listId ?? undefined, dueDate: getTodayUTC().toISOString(), dueDatePrecision: "day" },
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
    <SkeletonListView />
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
      onFocusChange={onFocusChange}
      header={<ThingsEmptyState activeFilter={activeFilter} hasThingsElsewhere allCompleted inline lists={lists} onAddTask={handleAddTask} onAddContent={handleAddContent} />}
    />
  ) : (
    <ThingsList things={filteredThings} lists={lists} onItemClick={onItemClick} onToggle={handleToggle} onAdd={handleAddTask} onTriageOpen={onTriageOpen} onFocusChange={onFocusChange} />
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

    </>
  );
}
