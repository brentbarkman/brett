import React, { useState, useEffect, useMemo, useRef, useLayoutEffect } from "react";
import {
  Omnibar,
  DailyBriefing,
  NextUpCard,
  useNextUpTimer,
  FilterPills,
  SectionHeader,
  ThingsList,
  ThingsEmptyState,
  CrossFade,
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
import { useLocalStorageBoolean } from "../lib/useLocalStorageBoolean";
import { useTonightExpansion } from "../lib/useTonightAutoExpand";

/** Section keys that render as collapsibles on Today. `tonight` is
 *  collapsible too but its open-state comes from `useTonightExpansion` (6pm
 *  auto-open with sticky per-day override) instead of localStorage.
 *  Overdue + Today stay always-expanded — they're the badge bucket and the
 *  reason the user opened the view. */
const COLLAPSIBLE_SECTION_KEYS = new Set(["tonight", "this-week", "this-weekend", "done-today"]);

interface TodayViewProps {
  lists: NavList[];
  onItemClick: (item: Thing | CalendarEventDisplay) => void;
  onTriageOpen: (
    mode: "list-first" | "date-first" | "list-only" | "date-only",
    ids: string[],
    thing?: { listId?: string | null; dueDate?: string; dueDatePrecision?: "day" | "week" | null },
    anchorEl?: HTMLElement | null,
  ) => void;
  onFocusChange?: (thing: Thing) => void;
  omnibarProps: OmnibarProps;
  nextUpEvent?: CalendarEventDisplay | null;
  nextUpTimer?: NextUpTimerState | null;
  onReconnect?: (sourceId: string) => void;
  reconnectPendingSourceId?: string;
  assistantName?: string;
  /** When true, the wallpaper behind the briefing is bright enough
   *  that the prose should render in warm-dark instead of white.
   *  Derived in App from `useBackgroundLuminance`. Default false keeps
   *  the prose white during cold launch / sample-in-flight. */
  washIsLight?: boolean;
}

export function TodayView({ lists, onItemClick, onTriageOpen, onFocusChange, omnibarProps, nextUpEvent, nextUpTimer, onReconnect, reconnectPendingSourceId, assistantName, washIsLight }: TodayViewProps) {
  const { install: installUpdate } = useAutoUpdate();
  const [activeFilter, setActiveFilter] = useState<FilterType>("All");
  const [briefingEnabled] = usePreference("briefingEnabled");

  // Briefing is visible unless disabled in settings — no per-day dismiss.
  const isBriefingVisible = briefingEnabled;

  // Auto-focus omnibar when landing on Today view
  useEffect(() => {
    if (!omnibarProps.isOpen) {
      omnibarProps.onOpen();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Daily briefing (real data from AI, or empty if not configured)
  const briefing = useBriefing();
  const summary = useBriefingSummary();

  // Date boundaries — recomputed when the user's LOCAL day rolls over so
  // tasks coming due today become visible without requiring an app reload.
  // todayKey is just the rollover trigger; the actual UTC ISO bounds come
  // straight from `getTodayUTC()` / `getEndOfWeekUTC()` so they stay correct
  // independent of the key's string format.
  const todayKey = useTodayKey();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const dueBefore = useMemo(() => getEndOfWeekUTC(new Date()).toISOString(), [todayKey]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // Hero NextUp pairs with the editorial briefing whenever there's an upcoming/now event today.
  // (Matches iOS — replaces the prior "expanded only when urgent" gate.)
  const showHeroNextUp = !!nextUpTimer && !nextUpTimer.isExpired;

  // Section grouping powers the chrome active-section header. The actual
  // section-divs live inside ThingsList and tag themselves with
  // `data-section-key`. We compute the same grouping here to source titles +
  // counts for the chrome header.
  const grouped = useMemo(() => {
    const uncompleted = filteredThings.filter((t) => !t.isCompleted);
    const done = filteredThings.filter((t) => t.isCompleted);
    const todayAll = uncompleted.filter((t) => t.urgency === "today");
    return {
      overdue: uncompleted.filter((t) => t.urgency === "overdue"),
      // Split today-day items: tonight render in their own section but
      // remain "today" tasks semantically (badge, urgency, etc.).
      today: todayAll.filter((t) => !t.tonight),
      tonight: todayAll.filter((t) => t.tonight),
      thisWeek: uncompleted.filter((t) => t.urgency === "this_week"),
      thisWeekend: uncompleted.filter((t) => t.urgency === "this_weekend"),
      done,
    };
  }, [filteredThings]);

  const sections = useMemo(() => {
    const dow = new Date().getUTCDay();
    const isWeekendNow = dow === 0 || dow === 6;
    const list: Array<{ key: string; title: string; count: number }> = [];
    if (grouped.overdue.length > 0) list.push({ key: "overdue", title: "Overdue", count: grouped.overdue.length });
    if (grouped.today.length > 0) list.push({ key: "today", title: "Today", count: grouped.today.length });
    if (grouped.tonight.length > 0) list.push({ key: "tonight", title: "Tonight", count: grouped.tonight.length });
    const weekend = grouped.thisWeekend.length > 0
      ? { key: "this-weekend", title: "This Weekend", count: grouped.thisWeekend.length }
      : null;
    const week = grouped.thisWeek.length > 0
      ? { key: "this-week", title: "This Week", count: grouped.thisWeek.length }
      : null;
    // Chronological ordering — weekend first on Sat/Sun (it's imminent),
    // week first on Mon-Fri (Fri comes before the weekend).
    if (isWeekendNow) {
      if (weekend) list.push(weekend);
      if (week) list.push(week);
    } else {
      if (week) list.push(week);
      if (weekend) list.push(weekend);
    }
    if (grouped.done.length > 0) list.push({ key: "done-today", title: "Done Today", count: grouped.done.length });
    return list;
  }, [grouped]);

  // Per-section collapsed state. Persisted per-user via localStorage so
  // toggling a section, navigating away, and coming back retains the choice.
  // Default `false` (collapsed) per the 2026-05-18 tuning spec.
  const [thisWeekOpen, setThisWeekOpen] = useLocalStorageBoolean("today.section.this-week.open", false);
  const [thisWeekendOpen, setThisWeekendOpen] = useLocalStorageBoolean("today.section.this-weekend.open", false);
  const [doneTodayOpen, setDoneTodayOpen] = useLocalStorageBoolean("today.section.done-today.open", false);

  // Tonight section's open/closed state: 6pm auto-expand with sticky user
  // override (per-date). Only meaningful on Today since custom-list and
  // Upcoming views don't surface Tonight as a separate section.
  const [tonightOpen, setTonightOpen] = useTonightExpansion();

  const collapsibleSections = useMemo(() => ({
    "tonight": { open: tonightOpen, onOpenChange: setTonightOpen },
    "this-week": { open: thisWeekOpen, onOpenChange: setThisWeekOpen },
    "this-weekend": { open: thisWeekendOpen, onOpenChange: setThisWeekendOpen },
    "done-today": { open: doneTodayOpen, onOpenChange: setDoneTodayOpen },
  }), [tonightOpen, setTonightOpen, thisWeekOpen, setThisWeekOpen, thisWeekendOpen, setThisWeekendOpen, doneTodayOpen, setDoneTodayOpen]);

  // For the chrome active-section header above the inner scroll: a collapsed
  // section has no items to scroll past, so it must never become the active
  // section. Track-only the visible (open or always-on) sections.
  const trackableSectionKeys = useMemo(() => {
    return new Set(
      sections
        .filter((s) =>
          !COLLAPSIBLE_SECTION_KEYS.has(s.key) ||
          collapsibleSections[s.key as keyof typeof collapsibleSections]?.open === true
        )
        .map((s) => s.key)
    );
  }, [sections, collapsibleSections]);

  const [activeSectionKey, setActiveSectionKey] = useState<string | null>(null);
  const sectionsScrollRef = useRef<HTMLDivElement>(null);
  const outerScrollRef = useRef<HTMLDivElement>(null);
  const thingsCardRef = useRef<HTMLDivElement>(null);

  // Re-sync active section when the section list changes (filter pill,
  // toggling done, collapsing a section, etc.) so we don't stick on a key
  // that no longer exists OR has been collapsed.
  useEffect(() => {
    setActiveSectionKey((prev) => {
      if (prev && trackableSectionKeys.has(prev)) return prev;
      const firstVisible = sections.find((s) => trackableSectionKeys.has(s.key));
      return firstVisible?.key ?? null;
    });
  }, [sections, trackableSectionKeys]);

  // Scroll tracker — picks the LAST section whose top is at or above the
  // inner-scroll's viewport top. That's the section the user is currently
  // reading. We rAF-throttle so wheel storms don't spam React renders.
  //
  // We listen to:
  //  1. The inner-scroll's `scroll` event (fires when user wheels on items).
  //  2. A document-level `scroll` listener with capture=true, which catches
  //     scroll events from any nested scrollable — defends against the case
  //     where the inner-scroll's event handler isn't picking up wheel input
  //     because of focus/cursor-position quirks.
  //  3. An IntersectionObserver on each section, which fires whenever a
  //     section's intersection with the inner-scroll viewport changes —
  //     catches anything the scroll events might miss.
  // Hash also includes trackable keys so collapse/expand re-runs the
  // recalc effect (the scroll listeners need fresh `trackableSectionKeys`
  // in their closure).
  const sectionKeysHash = sections.map((s) => s.key).join(",") +
    "|" + Array.from(trackableSectionKeys).sort().join(",");
  useEffect(() => {
    const el = sectionsScrollRef.current;
    if (!el || sections.length === 0) return;

    let raf = 0;
    const recalc = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const sectionEls = el.querySelectorAll<HTMLElement>("[data-section-key]");
        if (sectionEls.length === 0) return;
        const scrollTop = el.getBoundingClientRect().top;
        // Default to the first TRACKABLE section — never let a collapsed
        // section become the chrome active section (no items to scroll past).
        const firstTrackable = sections.find((s) => trackableSectionKeys.has(s.key));
        let activeKey: string | null = firstTrackable?.key ?? null;
        for (const sectionEl of sectionEls) {
          const key = sectionEl.dataset.sectionKey;
          if (!key || !trackableSectionKeys.has(key)) continue;
          const t = sectionEl.getBoundingClientRect().top;
          if (t <= scrollTop + 1) {
            activeKey = key;
          } else {
            break;
          }
        }
        setActiveSectionKey((prev) => (prev === activeKey ? prev : activeKey));
      });
    };

    el.addEventListener("scroll", recalc, { passive: true });
    document.addEventListener("scroll", recalc, { passive: true, capture: true });

    const observer = new IntersectionObserver(recalc, {
      root: el,
      threshold: [0, 0.5, 1],
    });
    el.querySelectorAll<HTMLElement>("[data-section-key]").forEach((s) => observer.observe(s));

    recalc();

    return () => {
      if (raf) cancelAnimationFrame(raf);
      el.removeEventListener("scroll", recalc);
      document.removeEventListener("scroll", recalc, true);
      observer.disconnect();
    };
  }, [sectionKeysHash]); // eslint-disable-line react-hooks/exhaustive-deps

  const activeSection = sections.find((s) => s.key === activeSectionKey);

  // Reverse scroll-chaining for downward wheels on the things-card: if the
  // outer scroll still has unscrolled distance (i.e. the briefing/NextUp
  // hero is still visible), redirect the wheel delta to the outer scroll
  // so the hero scrolls out FIRST, before the inner sections start moving.
  // Upward scrolls fall through to default behavior — inner first, then
  // outer — so users can scroll up through items before bringing the hero
  // back into view.
  useEffect(() => {
    const card = thingsCardRef.current;
    const outer = outerScrollRef.current;
    if (!card || !outer) return;

    const onWheel = (e: WheelEvent) => {
      if (e.deltaY <= 0) return; // upward — let default chain handle it
      const outerMax = outer.scrollHeight - outer.clientHeight;
      const outerRemaining = outerMax - outer.scrollTop;
      if (outerRemaining <= 0) return; // outer at end — let inner scroll
      e.preventDefault();
      const outerDelta = Math.min(e.deltaY, outerRemaining);
      outer.scrollTop += outerDelta;
      const leftover = e.deltaY - outerDelta;
      if (leftover > 0 && sectionsScrollRef.current) {
        sectionsScrollRef.current.scrollTop += leftover;
      }
    };

    card.addEventListener("wheel", onWheel, { passive: false });
    return () => card.removeEventListener("wheel", onWheel);
  }, []);

  // Scroll-compensation: when the active section flips, the previously-active
  // section's in-flow header reappears (display:none → flow), and the newly
  // active section's in-flow header collapses. That changes section.top by
  // ~15px per intervening section, which would visually pop the viewport.
  // We adjust scrollTop in a layout effect (synchronous, before paint) so the
  // user sees no jump.
  const prevActiveKeyRef = useRef<string | null>(null);
  useLayoutEffect(() => {
    const el = sectionsScrollRef.current;
    if (!el) return;
    const prev = prevActiveKeyRef.current;
    prevActiveKeyRef.current = activeSectionKey;
    if (prev === null || activeSectionKey === null || activeSectionKey === prev) return;
    const prevIdx = sections.findIndex((s) => s.key === prev);
    const newIdx = sections.findIndex((s) => s.key === activeSectionKey);
    if (prevIdx === -1 || newIdx === -1) return;
    // Measure the actual in-flow header height from a non-active section so
    // the compensation tracks any future SectionHeader sizing changes.
    let headerHeight = 16;
    const sampleSection = Array.from(
      el.querySelectorAll<HTMLElement>("[data-section-key]")
    ).find((s) => s.dataset.sectionKey !== activeSectionKey);
    const firstChild = sampleSection?.firstElementChild as HTMLElement | undefined;
    if (firstChild) {
      const rect = firstChild.getBoundingClientRect();
      if (rect.height > 0 && rect.height < 40) headerHeight = rect.height;
    }
    el.scrollTop += (newIdx - prevIdx) * headerHeight;
  }, [activeSectionKey]); // eslint-disable-line react-hooks/exhaustive-deps

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
      hiddenHeaderKey={activeSectionKey}
      collapsibleSections={collapsibleSections}
      header={<ThingsEmptyState activeFilter={activeFilter} hasThingsElsewhere allCompleted inline lists={lists} onAddTask={handleAddTask} onAddContent={handleAddContent} />}
    />
  ) : (
    <ThingsList things={filteredThings} lists={lists} onItemClick={onItemClick} onToggle={handleToggle} onAdd={handleAddTask} onAddContent={handleQuickAddContent} onTriageOpen={onTriageOpen} onFocusChange={onFocusChange} activeFilter={activeFilter} bare onReconnect={onReconnect} reconnectPendingSourceId={reconnectPendingSourceId} onInstallUpdate={installUpdate} hiddenHeaderKey={activeSectionKey} collapsibleSections={collapsibleSections} />
  );

  return (
    <div className="h-full flex flex-col">
      {/* Omnibar — fixed above the scroll container. Content can't slip
          behind it; the scroll's top edge IS the omnibar's bottom edge. */}
      <div className="flex-shrink-0">
        <Omnibar {...omnibarProps} />
      </div>

      <div ref={outerScrollRef} className="flex-1 min-h-0 overflow-y-auto scrollbar-hide">
        {isBriefingVisible && (
          <div className="mt-4">
            <DailyBriefing
              content={briefing.content}
              isError={briefing.isError}
              summary={summary.data ?? null}
              hasAI={briefing.hasAI}
              generatedAt={briefing.generatedAt}
              items={things.map((t) => ({ id: t.id, title: t.title }))}
              onRegenerate={briefing.regenerate}
              onItemClick={(id) => {
                const item = things.find((t) => t.id === id);
                if (item) onItemClick(item);
              }}
              assistantName={assistantName}
              washIsLight={washIsLight}
            />
          </div>
        )}

        {showHeroNextUp && nextUpEvent && nextUpTimer && (
          <div className="mt-2">
            <NextUpCard
              event={nextUpEvent}
              timer={nextUpTimer}
              variant="hero"
              onEventClick={() => onItemClick(nextUpEvent)}
            />
          </div>
        )}

        {/* Things card — pins at the top of the scroll once the hero scrolls
            out. Sized to fill the visible viewport so its inner content takes
            over scrolling when the outer reaches its end. */}
        <div
          ref={thingsCardRef}
          className="sticky mt-4 flex flex-col bg-black/40 backdrop-blur-xl rounded-xl border border-white/10 overflow-hidden"
          style={{
            top: 0,
            height: `calc(100% - 8px)`,
          }}
        >
        <div className="flex-shrink-0 px-4 pt-4 pb-3">
          <FilterPills
            activeFilter={activeFilter}
            onSelectFilter={setActiveFilter}
          />
        </div>

        {/* Active-section header — chrome above the inner scroll. The inner
            scroll's `overflow-hidden` clips items at this line so we don't
            need any background here. CrossFade animates the section swap
            (old fades out, new fades in). SectionHeader's internal mb-2
            stays — it pushes the inner scroll's top edge down so items
            scrolling up have breathing room before they hit the rule line. */}
        {activeSection && (
          <div className="flex-shrink-0 px-4">
            <CrossFade stateKey={activeSection.key} exitMs={140} enterMs={200}>
              <SectionHeader title={activeSection.title} count={activeSection.count} />
            </CrossFade>
          </div>
        )}

          <div ref={sectionsScrollRef} className="flex-1 min-h-0 overflow-y-auto scrollbar-hide px-4 pb-4">
            {/* No CrossFade around thingsContent: it caches children for one
                frame, which causes the in-flow Section header to render with a
                stale `hiddenHeaderKey` right after the chrome updates — visible
                as a duplicate. Direct render keeps the chrome and in-flow in
                lockstep. */}
            {thingsContent}
          </div>
        </div>
      </div>
    </div>
  );
}
