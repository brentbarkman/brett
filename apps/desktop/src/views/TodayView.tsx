import React, { useState, useEffect, useMemo } from "react";
import {
  Omnibar,
  DailyBriefing,
  NextUpCard,
  useNextUpTimer,
  FilterPills,
  ThingsList,
  ThingsEmptyState,
  CrossFade,
  TriagePopup,
  SkeletonListView,
} from "@brett/ui";
import type { OmnibarProps, NextUpTimerState } from "@brett/ui";
import type { Thing, CalendarEventDisplay, NavList, FilterType } from "@brett/types";
import { getTodayUTC, getEndOfWeekUTC } from "@brett/business";
import {
  useActiveThings,
  useDoneThings,
  useCreateThing,
  useToggleThing,
} from "../api/things";
import { useBriefing, useBriefingSummary } from "../api/briefing";
import { usePreference } from "../api/preferences";
import { useAutoUpdate } from "../hooks/useAutoUpdate";
import { useTodayKey } from "../hooks/useTodayKey";

interface TodayViewProps {
  lists: NavList[];
  onItemClick: (item: Thing | CalendarEventDisplay) => void;
  onTriageOpen: (mode: "list-first" | "date-first", ids: string[], thing?: { listId?: string | null; dueDate?: string; dueDatePrecision?: "day" | "week" | null }) => void;
  onFocusChange?: (thing: Thing) => void;
  omnibarProps: OmnibarProps;
  nextUpEvent?: CalendarEventDisplay | null;
  nextUpTimer?: NextUpTimerState | null;
  onReconnect?: (sourceId: string) => void;
  reconnectPendingSourceId?: string;
  assistantName?: string;
}

export function TodayView({ lists, onItemClick, onTriageOpen, onFocusChange, omnibarProps, nextUpEvent, nextUpTimer, onReconnect, reconnectPendingSourceId, assistantName }: TodayViewProps) {
  const { install: installUpdate } = useAutoUpdate();
  const [activeFilter, setActiveFilter] = useState<FilterType>("All");
  const [briefingEnabled] = usePreference("briefingEnabled");
  const [briefingDismissedDate, setBriefingDismissedDate] = usePreference("briefingDismissedDate");

  // Briefing is visible unless disabled in settings or dismissed today
  const today = new Date().toLocaleDateString("en-CA");
  const isBriefingVisible = briefingEnabled && briefingDismissedDate !== today;

  // Auto-focus omnibar when landing on Today view
  useEffect(() => {
    if (!omnibarProps.isOpen) {
      omnibarProps.onOpen();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Cmd+Ctrl+B — debug shortcut to re-show dismissed briefing
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey && e.ctrlKey && e.key === "b") {
        e.preventDefault();
        setBriefingDismissedDate(null);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [setBriefingDismissedDate]);

  // Daily briefing (real data from AI, or empty if not configured)
  const briefing = useBriefing();
  const summary = useBriefingSummary();

  // Date boundaries — recomputed when the UTC day rolls over so tasks coming
  // due today become visible without requiring an app reload.
  const todayKey = useTodayKey();
  const dueBefore = useMemo(() => getEndOfWeekUTC().toISOString(), [todayKey]);
  const completedAfter = useMemo(() => getTodayUTC().toISOString(), [todayKey]);

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

  const handleQuickAddContent = (url: string) => {
    createThing.mutate(
      { type: "content", title: url, sourceUrl: url, dueDate: getTodayUTC().toISOString(), dueDatePrecision: "day" as const },
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

  // Next Up card shows expanded when ≤10 min away (passed from App.tsx)
  const showExpandedNextUp = nextUpTimer?.isUrgent && !nextUpTimer?.isHappening;

  // Determine which state the things area is in for cross-fade
  const allCompleted = filteredThings.length > 0 && filteredThings.every((t) => t.isCompleted);
  const isEmpty = filteredThings.length === 0;
  const thingsStateKey = thingsLoading
    ? "loading"
    : isEmpty
      ? "empty"
      : "has-things";

  const thingsContent = thingsLoading ? (
    <SkeletonListView bare />
  ) : isEmpty ? (
    <ThingsEmptyState activeFilter={activeFilter} hasThingsElsewhere={things.length > 0} allCompleted={false} inline lists={lists} onAddTask={handleAddTask} onAddContent={handleAddContent} />
  ) : allCompleted ? (
    <ThingsList
      things={filteredThings}
      lists={lists}
      onItemClick={onItemClick}
      onToggle={handleToggle}
      onAdd={handleAddTask}
      onAddContent={handleQuickAddContent}
      onTriageOpen={onTriageOpen}
      onFocusChange={onFocusChange}
      activeFilter={activeFilter}
      bare
      onReconnect={onReconnect}
      reconnectPendingSourceId={reconnectPendingSourceId}
      onInstallUpdate={installUpdate}
      header={<ThingsEmptyState activeFilter={activeFilter} hasThingsElsewhere allCompleted inline lists={lists} onAddTask={handleAddTask} onAddContent={handleAddContent} />}
    />
  ) : (
    <ThingsList things={filteredThings} lists={lists} onItemClick={onItemClick} onToggle={handleToggle} onAdd={handleAddTask} onAddContent={handleQuickAddContent} onTriageOpen={onTriageOpen} onFocusChange={onFocusChange} activeFilter={activeFilter} bare onReconnect={onReconnect} reconnectPendingSourceId={reconnectPendingSourceId} onInstallUpdate={installUpdate} />
  );

  return (
    <>
      <Omnibar {...omnibarProps} />

      {isBriefingVisible && (
        <DailyBriefing
          content={briefing.content}
          isGenerating={briefing.isGenerating}
          isError={briefing.isError}
          summary={summary.data ?? null}
          hasAI={briefing.hasAI}
          generatedAt={briefing.generatedAt}
          items={things.map((t) => ({ id: t.id, title: t.title }))}
          onDismiss={() => setBriefingDismissedDate(new Date().toLocaleDateString("en-CA"))}
          onRegenerate={briefing.regenerate}
          onItemClick={(id) => {
            const item = things.find((t) => t.id === id);
            if (item) onItemClick(item);
          }}
          assistantName={assistantName}
        />
      )}

      {showExpandedNextUp && nextUpEvent && nextUpTimer && (
        <div className="animate-[fadeSlideIn_0.5s_ease-out]">
          <NextUpCard
            event={nextUpEvent}
            timer={nextUpTimer}
            variant="expanded"
            onEventClick={() => onItemClick(nextUpEvent)}
          />
        </div>
      )}

      <div className="bg-black/40 backdrop-blur-xl rounded-xl border border-white/10 p-4">
        <div className="pb-3">
          <FilterPills
            activeFilter={activeFilter}
            onSelectFilter={setActiveFilter}
          />
        </div>

        <CrossFade stateKey={thingsStateKey} exitMs={180} enterMs={280}>
          {thingsContent}
        </CrossFade>
      </div>

    </>
  );
}
