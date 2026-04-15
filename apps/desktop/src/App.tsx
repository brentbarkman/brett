import React, { useEffect, useState, useRef } from "react";
import { Routes, Route, Navigate, useNavigate, useLocation } from "react-router-dom";
import { slugify, getEventGlassColor } from "@brett/utils";
import { useAutoUpdate } from "./hooks/useAutoUpdate";
import { getEndOfWeekUTC } from "@brett/business";
import type { BackgroundStyle } from "@brett/business";
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
  NextUpCard,
  useNextUpTimer,
  parseTimeToMinutes,
  DetailPanel,
  InboxView,
  TriagePopup,
  InboxDragOverlay,
  ConfirmDialog,
  AppDropZone,
  cleanFilename,
  SpotlightModal,
  ScoutsRoster,
  ScoutDetail,
  LivingBackground,
  BackgroundScrim,
} from "@brett/ui";
import { useAwakeningVideo, _resetAwakeningSessionFlag } from "./hooks/useAwakeningVideo";
import { useAppConfig } from "./hooks/useAppConfig";
import type { Thing, CalendarEventDisplay, CalendarEventRecord, DueDatePrecision, ReminderType, RecurrenceType, Scout } from "@brett/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "./api/client";
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
  useRetryExtraction,
  useThings,
  useListSuggestions,
} from "./api/things";
import { useLists, useCreateList, useUpdateList, useDeleteList, useReorderLists, useArchiveList, useUnarchiveList, useArchivedLists } from "./api/lists";
import { useUploadAttachment, useDeleteAttachment } from "./api/attachments";
import { useBrettChat } from "./api/brett-chat";
import { useCreateLink, useDeleteLink } from "./api/links";
import {
  useCalendarEvents,
  useCalendarEventDetail,
  useUpdateRsvp,
  useUpdateCalendarEventNotes,
  useRelatedItems,
  useMeetingHistory,
} from "./api/calendar";
import { useCalendarAccounts, useConnectCalendar } from "./api/calendar-accounts";
import { useGranolaMeetingForEvent, useReprocessMeetingActions } from "./api/granola";
import { useEventStream, useSSEHandler } from "./api/sse";
import { useTimezoneSync } from "./api/timezone";
import { useBackground } from "./hooks/useBackground";
import { initDiagnostics, collectDiagnostics, recordRouteChange, type DiagnosticSnapshot } from "./lib/diagnostics";
import { FeedbackModal } from "./components/FeedbackModal";
import { useFavicon } from "./hooks/useFavicon";
import { useOmnibar } from "./api/omnibar";
import { useSessionUsage } from "./api/ai-usage";
import { usePreference } from "./api/preferences";
import { useWeather } from "./api/weather";
import { useBrokenConnections, useReconnect } from "./api/connection-health";
import { useAssistantName } from "./api/assistant-name";
import { CalendarConnectModal } from "./components/CalendarConnectModal";
import { SettingsPage } from "./settings/SettingsPage";
import { TodayView } from "./views/TodayView";
import { ListView } from "./views/ListView";
import { UpcomingView } from "./views/UpcomingView";
import { NotFoundView } from "./views/NotFoundView";
import CalendarPage from "./pages/CalendarPage";
import {
  useScouts,
  useScout,
  useScoutFindings,
  useScoutActivity,
  useScoutMemories,
  useDeleteScoutMemory,
  usePauseScout,
  useResumeScout,
  useUpdateScout,
  useTriggerScoutRun,
  useTriggerConsolidation,
  useClearScoutHistory,
  useDeleteScout,
  useSubmitScoutFeedback,
  useRecentFindings,
} from "./api/scouts";
import type { RecentFindingItem } from "@brett/ui";

const SIDEBAR_DISMISSED_KEY = "brett-calendar-sidebar-dismissed";

// ----- Awakening timing (Ken Burns cold-launch reveal) -----
/** Ken Burns scale transition duration (scale 1.15 → 1.0 on
 *  LivingBackground). Cover fade (1950ms) finishes before this, so the
 *  image keeps settling for ~550ms after the UI is fully revealed. */
const AWAKENING_REVEAL_MS = 2500;

// ---- Reveal mode prototype ----
// Three experimental modes for how the UI appears on cold launch. Dev-only
// toggle (bottom-right pill) cycles between them + persists to localStorage.
//
// - "fade":  current behavior. UI shell animates opacity 0 → 1. Glass cards
//            suffer a small "pop" at opacity === 1 due to Chromium's
//            opacity-group behavior with backdrop-filter descendants.
// - "cover": UI shell always at opacity 1. A black overlay above UI (z-30)
//            starts opaque and fades to transparent — this reveal IS the UI
//            fade. Glass cards render continuously at full quality (no pop)
//            because no ancestor opacity animates. Trade-off: the cover
//            also covers BG initially, so user sees solid black briefly
//            before BG + UI reveal together.
// - "snap":  UI shell visibility: hidden → visible at a timed moment. No
//            fade on UI — it just appears. Glass is always at full quality.
//            Trade-off: "instant" UI feel, not a soft fade.
type AwakeningRevealMode = "fade" | "cover" | "snap";
const REVEAL_MODE_KEY = "awakening-reveal-mode";

function getStoredRevealMode(): AwakeningRevealMode {
  try {
    const stored = localStorage.getItem(REVEAL_MODE_KEY);
    if (stored === "fade" || stored === "cover" || stored === "snap") return stored;
  } catch { /* ignore */ }
  return "fade";
}

// --- Timings per mode ---
/** "fade" mode: how long to show BG alone before UI opacity starts rising. */
const AWAKENING_UI_DELAY_MS = 300;
/** "fade" mode: UI opacity transition duration. Ends at 300 + 1400 = 1700ms
 *  (before Ken Burns ends at 2000ms) — gives the image 300ms of solo
 *  settling motion after UI is fully revealed. */
const AWAKENING_UI_FADE_MS = 1400;
/** "cover" mode: how long cover stays fully opaque before fading. Short
 *  enough to not feel like a "black screen pause" on cold launch, long
 *  enough to hide the visible part of ThingsList's sectionEnter slide
 *  (ease-out curve, so most of the translate completes in the first
 *  ~150ms). The tail of sectionEnter (~200-450ms) settles behind the
 *  fading cover — tiny translate deltas at that point, imperceptible. */
const COVER_OPAQUE_MS = 200;
/** "cover" mode: cover fade-out duration. 450 + 1500 = 1950ms (just before
 *  Ken Burns end). */
const COVER_FADE_MS = 1500;
/** "snap" mode: how long to show BG alone before UI snaps visible. */
const SNAP_DELAY_MS = 500;

function MainLayout({ children, onEventClick, calendarEvents, isLoadingCalendar, showSidebar, onConnectCalendar, onDismissSidebar, sidebarDate, onPrevDay, onNextDay, onToday, nextUpEvent, nextUpTimer, assistantName }: {
  children: React.ReactNode;
  onEventClick: (e: any) => void;
  calendarEvents: CalendarEventDisplay[];
  isLoadingCalendar?: boolean;
  showSidebar: boolean;
  onConnectCalendar?: () => void;
  onDismissSidebar?: () => void;
  sidebarDate?: Date;
  onPrevDay?: () => void;
  onNextDay?: () => void;
  onToday?: () => void;
  nextUpEvent?: CalendarEventDisplay | null;
  nextUpTimer?: import("@brett/ui").NextUpTimerState | null;
  assistantName?: string;
}) {
  // Show compact card in sidebar when not urgent (>10 min) or happening now
  const showCompactInSidebar = nextUpTimer && !nextUpTimer.isExpired && !(nextUpTimer.isUrgent && !nextUpTimer.isHappening);

  return (
    <>
      <main className="flex-1 min-w-0 overflow-y-auto scrollbar-hide py-2 [-webkit-app-region:no-drag]">
        <div className="max-w-3xl mx-auto w-full space-y-4">
          {children}
        </div>
      </main>
      {showSidebar && (
        <div className="w-[300px] flex-shrink-0 py-2 flex flex-col gap-3 [-webkit-app-region:no-drag]">
          {showCompactInSidebar && nextUpEvent && nextUpTimer && (
            <div className="flex-shrink-0">
              <NextUpCard
                event={nextUpEvent}
                timer={nextUpTimer}
                variant="compact"
                onEventClick={() => onEventClick(nextUpEvent)}
              />
            </div>
          )}
          <div className="flex-1 min-h-0">
            <CalendarTimeline events={calendarEvents} onEventClick={onEventClick} isLoading={isLoadingCalendar} onConnect={onConnectCalendar} onDismiss={onDismissSidebar} date={sidebarDate} onPrevDay={onPrevDay} onNextDay={onNextDay} onToday={onToday} assistantName={assistantName} />
          </div>
        </div>
      )}
    </>
  );
}

/** Map CalendarEventRecord to CalendarEventDisplay for the sidebar timeline */
function recordToDisplay(r: CalendarEventRecord): CalendarEventDisplay {
  const color = getEventGlassColor(r.calendarColor);
  return {
    id: r.id,
    title: r.title,
    startTime: r.startTime,
    endTime: r.endTime,
    durationMinutes: Math.max((new Date(r.endTime).getTime() - new Date(r.startTime).getTime()) / 60000, 0),
    color,
    location: r.location ?? undefined,
    attendees: r.attendees?.map((a) => {
      const name = a.name || a.email || "Unknown";
      return {
        name,
        initials: name.split(" ").map((n: string) => n[0]).join("").toUpperCase().slice(0, 2),
        email: a.email,
        responseStatus: a.responseStatus,
      };
    }),
    hasBrettContext: !!r.brettObservation,
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
  const queryClient = useQueryClient();

  // Initialize SSE for real-time updates
  useEventStream();
  useTimezoneSync();
  const { install: installUpdate, updateReady } = useAutoUpdate();

  // Initialize diagnostics ring buffers for feedback
  useEffect(() => {
    initDiagnostics();
  }, []);

  // Track route changes for diagnostics breadcrumbs
  useEffect(() => {
    recordRouteChange(location.pathname + location.hash);
  }, [location.pathname, location.hash]);

  // Cache electron version for diagnostics (fetched once at startup)
  const [electronVersion, setElectronVersion] = useState<string>("unknown");
  useEffect(() => {
    const electronAPI = (window as any).electronAPI;
    if (electronAPI?.getSystemInfo) {
      electronAPI.getSystemInfo().then((info: { electronVersion: string }) => {
        setElectronVersion(info.electronVersion);
      }).catch(() => {});
    }
  }, []);

  // Feedback modal state
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackDiagnostics, setFeedbackDiagnostics] = useState<DiagnosticSnapshot | null>(null);
  const [feedbackScreenshot, setFeedbackScreenshot] = useState<string | null>(null);

  const [selectedItem, setSelectedItem] = useState<
    Thing | CalendarEventDisplay | null
  >(null);
  const [detailHistory, setDetailHistory] = useState<(Thing | CalendarEventDisplay)[]>([]);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [selectedScoutId, setSelectedScoutId] = useState<string | null>(null);
  const [scoutRunning, setScoutRunning] = useState(false);

  // Triage popup state
  const [triageState, setTriageState] = useState<{
    mode: "list-first" | "date-first";
    ids: string[];
    currentListId?: string | null;
    currentDueDate?: string | null;
    currentDueDatePrecision?: "day" | "week" | null;
  } | null>(null);

  // Semantic list suggestions for the active triage item
  const { data: listSuggestionsData } = useListSuggestions(
    triageState?.ids[0] ?? null
  );

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
  const retryExtraction = useRetryExtraction();
  const bulkUpdate = useBulkUpdateThings();

  // Attachment hooks
  const uploadAttachment = useUploadAttachment();
  const deleteAttachment = useDeleteAttachment();

  // Link hooks
  const createLink = useCreateLink();
  const deleteLink = useDeleteLink();

  // Brett thread hooks — now using streaming chat

  // Calendar account state — for sidebar visibility
  const { data: calendarAccounts = [] } = useCalendarAccounts();
  const connectCalendar = useConnectCalendar();
  const hasCalendarAccounts = calendarAccounts.length > 0;
  const [sidebarDismissed, setSidebarDismissed] = useState(
    () => localStorage.getItem(SIDEBAR_DISMISSED_KEY) === "true",
  );
  const showCalendarSidebar = hasCalendarAccounts || !sidebarDismissed;

  const [showCalendarConnectModal, setShowCalendarConnectModal] = useState(false);

  const handleConnectCalendar = () => {
    setShowCalendarConnectModal(true);
  };

  const handleDismissSidebar = () => {
    setSidebarDismissed(true);
    localStorage.setItem(SIDEBAR_DISMISSED_KEY, "true");
  };

  // Clear dismissed state when accounts are connected
  useEffect(() => {
    if (hasCalendarAccounts && sidebarDismissed) {
      setSidebarDismissed(false);
      localStorage.removeItem(SIDEBAR_DISMISSED_KEY);
    }
  }, [hasCalendarAccounts, sidebarDismissed]);

  // Local day boundaries as ISO timestamps for API queries.
  // Always send full ISO strings — never date-only strings like "2026-03-29" —
  // because the API would interpret them as UTC midnight, shifting day boundaries.
  function localDayBounds(d: Date): { startDate: string; endDate: string } {
    const start = new Date(d);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return { startDate: start.toISOString(), endDate: end.toISOString() };
  }

  // Today's bounds (stable for the session — doesn't change when sidebar navigates)
  const [todayBounds] = useState(() => localDayBounds(new Date()));

  // Sidebar calendar date navigation
  const [sidebarDate, setSidebarDate] = useState(() => new Date());
  const sidebarBounds = localDayBounds(sidebarDate);

  const handleSidebarPrevDay = () => {
    setSidebarDate((d) => { const n = new Date(d); n.setDate(n.getDate() - 1); return n; });
  };
  const handleSidebarNextDay = () => {
    setSidebarDate((d) => { const n = new Date(d); n.setDate(n.getDate() + 1); return n; });
  };
  const handleSidebarToday = () => {
    setSidebarDate(new Date());
  };

  const { data: sidebarCalendarData, isLoading: isLoadingSidebarCalendar } = useCalendarEvents(sidebarBounds);
  const sidebarCalendarEvents: CalendarEventDisplay[] =
    (sidebarCalendarData?.events ?? []).filter((e: CalendarEventRecord) => !e.isAllDay).map(recordToDisplay);

  // Today's events for Next Up — always pinned to today, independent of sidebar navigation
  const { data: todayCalendarData } = useCalendarEvents(todayBounds);
  const todayCalendarEvents: CalendarEventDisplay[] =
    (todayCalendarData?.events ?? []).filter((e: CalendarEventRecord) => !e.isAllDay).map(recordToDisplay);

  // Next Up: find the next upcoming event from TODAY (not the sidebar date)
  const nextUpEvent = (() => {
    if (!todayCalendarEvents.length) return null;
    const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
    return todayCalendarEvents.find((e) => {
      if (e.myResponseStatus === "declined" || e.isAllDay) return false;
      return parseTimeToMinutes(e.endTime) > nowMin;
    }) ?? null;
  })();
  const nextUpTimer = useNextUpTimer(nextUpEvent);

  // Fetch detail when panel is open and item is a task (not a CalendarEvent)
  const selectedId = selectedItem?.id ?? null;
  const isTaskSelected = selectedItem ? !("googleEventId" in selectedItem) : false;
  const isCalendarSelected = selectedItem ? "googleEventId" in selectedItem : false;
  const { data: thingDetail, isLoading: isLoadingDetail } = useThingDetail(
    isDetailOpen && isTaskSelected ? selectedId : null,
  );

  // Brett chat for selected item (streaming)
  const brett = useBrettChat({
    itemId: isDetailOpen && isTaskSelected ? selectedId : null,
  });

  // Calendar event detail panel hooks
  const { data: calendarEventDetail, isLoading: isLoadingCalendarDetail } = useCalendarEventDetail(
    isDetailOpen && isCalendarSelected ? selectedId : null,
  );
  const { data: meetingNote } = useGranolaMeetingForEvent(
    isDetailOpen && isCalendarSelected ? selectedId : null,
  );
  const { data: calendarRelatedItemsData } = useRelatedItems(
    isDetailOpen && isCalendarSelected ? selectedId : null,
  );
  const { data: calendarMeetingHistoryData } = useMeetingHistory(
    isDetailOpen && isCalendarSelected ? selectedId : null,
  );
  const reprocessMeeting = useReprocessMeetingActions();
  const updateRsvp = useUpdateRsvp();
  const updateCalendarNotes = useUpdateCalendarEventNotes();
  const calendarBrett = useBrettChat({
    calendarEventId: isDetailOpen && isCalendarSelected ? selectedId : null,
  });

  // Active things for link search
  const { data: allActiveThings = [] } = useThings({ status: "active" });

  // Search items for linked items
  const handleSearchItems = async (query: string) => {
    const q = query.toLowerCase();
    return allActiveThings.filter(
      (t) =>
        t.id !== selectedId && t.title.toLowerCase().includes(q),
    );
  };

  // Today badge count — active items due this week or earlier
  const [endOfWeekISO] = useState(() => getEndOfWeekUTC().toISOString());
  const { data: activeThingsForCount = [] } = useActiveThings(endOfWeekISO);

  // Upcoming badge count
  const { data: upcomingThings = [] } = useUpcomingThings();

  // Inbox data
  const { data: inboxData } = useInboxThings();

  // Scout hooks
  const { data: scouts = [], isLoading: isLoadingScouts } = useScouts();
  const { data: selectedScoutDetail } = useScout(selectedScoutId);
  // Use detail from React Query if available, otherwise fall back to the scout from the list
  // to avoid a flash on first open while the detail query loads
  const selectedScoutData = selectedScoutDetail ?? scouts.find((s) => s.id === selectedScoutId);
  const { data: findingsData, isLoading: isLoadingFindings } = useScoutFindings(selectedScoutId);
  const { data: recentFindingsData, isLoading: isLoadingRecentFindings } = useRecentFindings();
  const scoutFindings = findingsData?.findings ?? [];
  const { data: activityData, isLoading: isLoadingActivity } = useScoutActivity(selectedScoutId);
  const scoutActivity = activityData?.entries ?? [];
  const pauseScout = usePauseScout();
  const resumeScout = useResumeScout();
  const updateScout = useUpdateScout();
  const triggerRun = useTriggerScoutRun();
  const triggerConsolidation = useTriggerConsolidation();
  const clearHistory = useClearScoutHistory();
  const deleteScout = useDeleteScout();
  const submitFeedback = useSubmitScoutFeedback();
  const { data: scoutMemories = [], isLoading: isLoadingMemories } = useScoutMemories(selectedScoutId ?? undefined);
  const deleteMemory = useDeleteScoutMemory();

  // Omnibar state (shared between bar and spotlight)
  const omnibar = useOmnibar();
  const assistantName = useAssistantName();

  // Weather state for omnibar pill
  const { weather, now: weatherNow, isLoading: weatherLoading } = useWeather();
  const [showWeatherExpanded, setShowWeatherExpanded] = useState(false);

  // Connection health — broken integration badges + reconnect action
  const { data: brokenConnections } = useBrokenConnections();
  const { reconnect: handleReconnect, isPending: reconnectPending, pendingSourceId: reconnectPendingSourceId } = useReconnect();

  // Token usage tracking — reactive to Settings toggle
  const [showTokenUsage] = usePreference("showTokenUsage");
  const { data: sessionUsageData } = useSessionUsage(
    showTokenUsage ? omnibar.sessionId : null,
  );

  // Compute today's task count — tasks due today or overdue
  const todayTaskCount = (() => {
    if (!activeThingsForCount) return 0;
    const endOfToday = new Date(todayBounds.endDate);
    return activeThingsForCount.filter((t: any) => {
      if (!t.dueDate) return false;
      return new Date(t.dueDate) <= endOfToday;
    }).length;
  })();

  // Meeting count from today's calendar events
  const todayMeetingCount = todayCalendarEvents?.length ?? 0;

  // Background style + avg busyness from user preferences
  const { data: userPrefs } = useQuery({
    queryKey: ["user-me"],
    queryFn: () => apiFetch<{ backgroundStyle?: string; pinnedBackground?: string | null; avgBusynessScore?: number }>("/users/me"),
    staleTime: 5 * 60 * 1000,
  });
  const backgroundStyle: BackgroundStyle = (userPrefs?.backgroundStyle as BackgroundStyle) ?? "photography";
  const avgBusynessScore = userPrefs?.avgBusynessScore ?? 0;

  // Sync busyness average on app mount (fire-and-forget)
  useEffect(() => {
    apiFetch("/users/busyness-sync", { method: "POST" }).catch(() => {});
  }, []);

  const pinnedBackground = userPrefs?.pinnedBackground ?? null;

  const background = useBackground({
    meetingCount: todayMeetingCount,
    taskCount: todayTaskCount,
    backgroundStyle,
    avgBusynessScore,
    pinnedBackground,
  });

  // Awakening — plays once on cold launch, hides LivingBackground's
  // own previous-segment crossfade so the user sees: black → reveal → settled
  // current-segment image, instead of: previous-segment → reveal → current-segment.
  const { data: appConfig } = useAppConfig();
  const awakening = useAwakeningVideo({
    baseUrl: appConfig?.storageBaseUrl ?? "",
    segment: background.segment,
  });
  // Awakening: LivingBackground image starts at scale(1.15) and transitions
  // to scale(1.0) over AWAKENING_REVEAL_MS. How the UI arrives is
  // mode-dependent (see AwakeningRevealMode).
  //
  // uiRevealed is a unified "UI should be visible" flag:
  //   - "fade":  drives UI shell opacity (0 → 1)
  //   - "cover": drives cover opacity INVERSE (cover = 1-revealed)
  //   - "snap":  drives UI visibility (hidden → visible)
  const [awakeningMode] = useState<AwakeningRevealMode>(getStoredRevealMode);
  const [awakeningPhase, setAwakeningPhase] = useState<"playing" | "fading">("playing");
  const [uiRevealed, setUiRevealed] = useState(() => awakening.status === "skip");

  useEffect(() => {
    if (awakening.status === "skip") {
      // Session already played / reduced motion — no animation, UI instant.
      setAwakeningPhase("fading");
      setUiRevealed(true);
      return;
    }
    // Wait for the real wallpaper to be loaded before kicking off Ken Burns.
    // If we started the animation on the empty (black) initial state and the
    // image loaded mid-zoom, the user would see an abrupt image pop-in.
    if (!background.hasLoadedImage) return;
    // Pick the mode-specific delay before flipping uiRevealed.
    const uiDelay =
      awakeningMode === "fade"
        ? AWAKENING_UI_DELAY_MS
        : awakeningMode === "cover"
        ? COVER_OPAQUE_MS
        : SNAP_DELAY_MS;
    // Double rAF ensures the initial frame (scale(1.15), UI hidden) has
    // painted before we flip state — so the browser runs a real transition
    // rather than short-circuiting to the final values.
    let raf2 = 0;
    let uiTimer: ReturnType<typeof setTimeout> | undefined;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        setAwakeningPhase("fading");
        uiTimer = setTimeout(() => setUiRevealed(true), uiDelay);
      });
    });
    return () => {
      cancelAnimationFrame(raf1);
      if (raf2) cancelAnimationFrame(raf2);
      if (uiTimer) clearTimeout(uiTimer);
    };
  }, [awakening.status, background.hasLoadedImage, awakeningMode]);

  // Track whether spotlight should open with search pre-selected (Cmd+F)
  const [spotlightInitialAction, setSpotlightInitialAction] = useState<"search" | null>(null);

  // Global Cmd+K / Ctrl+K listener for spotlight
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        if (omnibar.isOpen && omnibar.mode === "spotlight") {
          omnibar.close();
        } else {
          setSpotlightInitialAction(null);
          omnibar.open("spotlight");
          setSelectedItem(null);
          setIsDetailOpen(false);
        }
      }
      // Cmd+F / Ctrl+F opens spotlight with search pre-selected
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === "f") {
        e.preventDefault();
        if (omnibar.isOpen && omnibar.mode === "spotlight") {
          omnibar.close();
        } else {
          setSpotlightInitialAction("search");
          omnibar.open("spotlight");
          setSelectedItem(null);
          setIsDetailOpen(false);
        }
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [omnibar]);

  // Cmd+Shift+. opens feedback modal
  useEffect(() => {
    const handleFeedbackShortcut = async (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === ".") {
        e.preventDefault();
        if (feedbackOpen) return;

        // Capture screenshot BEFORE opening modal
        let screenshot: string | null = null;
        try {
          const electronAPI = (window as any).electronAPI;
          if (electronAPI?.captureScreenshot) {
            screenshot = await electronAPI.captureScreenshot();
          }
        } catch (err) {
          console.error("[feedback] Screenshot capture failed:", err);
        }

        // Snapshot diagnostics
        const diag = collectDiagnostics(electronVersion);

        setFeedbackScreenshot(screenshot);
        setFeedbackDiagnostics(diag);
        setFeedbackOpen(true);
      }
    };
    document.addEventListener("keydown", handleFeedbackShortcut);
    return () => document.removeEventListener("keydown", handleFeedbackShortcut);
  }, [feedbackOpen, electronVersion]);

  // Build omnibar props for the bar component
  const currentView = (() => {
    const path = location.pathname;
    if (path === "/today") return "today";
    if (path === "/upcoming") return "upcoming";
    if (path === "/inbox") return "inbox";
    if (path === "/calendar") return "calendar";
    if (path === "/settings") return "settings";
    if (path === "/scouts") return "scouts";
    if (path.startsWith("/lists/")) return `list:${path.split("/lists/")[1]}`;
    return undefined;
  })();

  const omnibarProps = {
    isOpen: omnibar.isOpen && omnibar.mode === "bar",
    input: omnibar.input,
    onInputChange: omnibar.setInput,
    messages: omnibar.messages,
    isStreaming: omnibar.isStreaming,
    hasAI: omnibar.hasAI,
    onSend: (text: string, intent?: string) => omnibar.send(text, currentView, intent),
    onCreateTask: (title: string) => omnibar.createTask(title, currentView),
    onSearch: omnibar.searchThings,
    onNavigate: (path: string) => {
      navigate(path);
      omnibar.close();
    },
    onItemClick: (id: string) => {
      // Create a minimal Thing to open the detail panel — it will fetch full data
      setSelectedItem({ id, title: "", type: "task", list: "", listId: null, status: "active", source: "", urgency: "later", isCompleted: false } as any);
      setIsDetailOpen(true);
    },
    onEventClick: (eventId: string) => {
      const event = sidebarCalendarEvents.find((e) => e.id === eventId);
      if (event) {
        handleItemClick(event);
      } else {
        setSelectedItem({ id: eventId, googleEventId: "", title: "", startTime: "", endTime: "", durationMinutes: 0, color: "blue", hasBrettContext: false, isAllDay: false, myResponseStatus: "needsAction" } as any);
        setIsDetailOpen(true);
      }
      omnibar.close();
    },
    searchResults: omnibar.searchResults ?? null,
    isSearching: omnibar.isSearching,
    onSearchResultClick: (id: string) => {
      // Fallback click handler for entity types not handled by onItemClick/onEventClick
      navigate("/inbox");
      omnibar.close();
    },
    onClose: () => { omnibar.close(); setShowWeatherExpanded(false); },
    onOpen: () => { omnibar.open("bar"); setSelectedItem(null); setIsDetailOpen(false); },
    onCancel: omnibar.cancel,
    onReset: omnibar.reset,
    onNavigateToSettings: () => navigate("/settings#ai-providers"),
    onNavigateToLocationSettings: () => navigate("/settings#timezone-location"),
    sessionId: omnibar.sessionId,
    showTokenUsage,
    sessionUsage: sessionUsageData ?? null,
    weather,
    weatherNow,
    weatherLoading,
    showWeatherExpanded,
    onWeatherClick: () => setShowWeatherExpanded((prev) => !prev),
    assistantName,
  };

  const scoutsOmnibarProps = {
    ...omnibarProps,
    isOpen: omnibar.isOpen && omnibar.mode === "bar",
    onSend: (text: string, intent?: string) => omnibar.send(text, "scouts", intent),
    onOpen: () => { omnibar.open("bar"); },
    weather: null,
    weatherNow: undefined,
    weatherLoading: false,
    showWeatherExpanded: false,
    onWeatherClick: undefined,
    onNavigateToSettings: undefined,
    onNavigateToLocationSettings: undefined,
  };

  // Apply dark mode to root
  useEffect(() => {
    document.documentElement.classList.add("dark");
  }, []);

  // Handle escape key to close detail panel or navigate back from scout detail
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (triageState) {
          setTriageState(null);
          return;
        }
        if (isDetailOpen) {
          setIsDetailOpen(false);
          setTimeout(() => setSelectedItem(null), 300);
          return;
        }
        if (location.pathname === "/scouts" && selectedScoutId) {
          setSelectedScoutId(null);
          return;
        }
      }
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [triageState, isDetailOpen, location.pathname, selectedScoutId]);

  const handleItemClick = (item: Thing | CalendarEventDisplay) => {
    setSelectedItem(item);
    setDetailHistory([]);
    setIsDetailOpen(true);
  };

  // Navigate within the detail panel (pushes current item to history stack)
  const handleDetailDrillDown = (item: Thing | CalendarEventDisplay) => {
    if (selectedItem) {
      setDetailHistory((prev) => [...prev, selectedItem]);
    }
    setSelectedItem(item);
  };

  const handleDetailBack = () => {
    const prev = detailHistory[detailHistory.length - 1];
    if (prev) {
      setDetailHistory((h) => h.slice(0, -1));
      setSelectedItem(prev);
    }
  };

  // Adapter for CalendarPage which passes CalendarEventRecord
  const handleCalendarEventClick = (event: CalendarEventRecord) => {
    handleItemClick(recordToDisplay(event));
  };

  // Update panel when keyboard nav changes focus (only if panel is open)
  const handleFocusChange = (thing: Thing) => {
    if (isDetailOpen) {
      setSelectedItem(thing);
    }
  };

  const handleCloseDetail = () => {
    setIsDetailOpen(false);
    setDetailHistory([]);
    setTimeout(() => setSelectedItem(null), 300);
  };

  useSSEHandler("scout.run.completed", () => {
    setScoutRunning(false);
  });

  useSSEHandler("calendar.event.deleted", (data: { eventId: string }) => {
    if (selectedItem && selectedItem.id === data.eventId) {
      handleCloseDetail();
    }
  });

  const handleToggle = (id: string) => {
    toggleThing.mutate(id);
    // Close detail panel if the toggled item is the one currently open
    if (selectedItem && selectedItem.id === id) {
      handleCloseDetail();
    }
  };

  // Inbox-specific handlers
  const handleInboxAdd = (title: string) => {
    createThing.mutate(
      { type: "task", title },
      { onError: (err) => console.error("Failed to create thing:", err) }
    );
  };

  // Scout handlers
  const handleSelectScout = (scout: Scout) => {
    setSelectedScoutId(scout.id);
  };

  const handleBackToRoster = () => {
    setSelectedScoutId(null);
  };

  // Open omnibar pre-filled to start the create_scout conversational flow
  const handleNewScout = () => {
    omnibar.reset();
    omnibar.setInput("Create a scout to ");
    omnibar.open("spotlight");
  };

  // Track newly created scout for "NEW" badge
  const [newScoutId, setNewScoutId] = useState<string | null>(null);
  const newScoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Detect successful scout creation in the omnibar and navigate to the new scout
  useEffect(() => {
    for (const msg of omnibar.messages) {
      if (msg.role !== "assistant") continue;
      for (const tc of msg.toolCalls ?? []) {
        if (tc.name === "create_scout" && tc.result) {
          const result = tc.result as { success?: boolean; data?: { id?: string } };
          if (result.success && result.data?.id) {
            const scoutId = result.data.id;
            setSelectedScoutId(scoutId);
            // Collapse omnibar back to bar on the scouts page
            omnibar.reset();
            // Show "NEW" badge that fades after 5 seconds
            setNewScoutId(scoutId);
            if (newScoutTimerRef.current) clearTimeout(newScoutTimerRef.current);
            newScoutTimerRef.current = setTimeout(() => setNewScoutId(null), 5000);
          }
        }
      }
    }
  }, [omnibar]);

  const handleInboxAddContent = (url: string) => {
    createThing.mutate(
      { type: "content", title: url, sourceUrl: url },
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
    if (!selectedItem || "googleEventId" in selectedItem) return;
    const item = selectedItem as Thing;
    createThing.mutate({ type: "task", title: `${item.title} (copy)`, listId: item.listId ?? undefined });
  };

  const handleMoveToList = (id: string) => {
    if (!selectedItem || "googleEventId" in selectedItem) return;
    const item = selectedItem as Thing;
    handleTriageOpen("list-first", [id], { listId: item.listId, dueDate: item.dueDate ?? undefined, dueDatePrecision: item.dueDatePrecision });
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
  const handleDragStart = (event: DragStartEvent) => {
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
  };

  const handleDragEnd = (event: DragEndEvent) => {
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
  };

  const handleDropPdf = (file: File) => {
    const title = cleanFilename(file.name);
    createThing.mutate(
      { type: "content", title, contentType: "pdf" },
      {
        onSuccess: (newItem: Thing) => {
          // Upload the file as an attachment
          uploadAttachment.mutate({ itemId: newItem.id, file });
        },
        onError: (err) => console.error("Failed to create PDF item:", err),
      },
    );
  };

  const inboxCount = inboxData?.visible.length ?? 0;

  // Dynamic window title: "(3) Jarvis" or just "Jarvis"
  useEffect(() => {
    document.title = inboxCount > 0 ? `(${inboxCount}) ${assistantName}` : assistantName;
  }, [inboxCount, assistantName]);

  // Dynamic favicon: working (Brett streaming) > count badge > default
  const faviconMode = omnibar.isStreaming ? "working" as const : "default" as const;
  useFavicon(faviconMode, todayTaskCount);

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <AppDropZone onDropPdf={handleDropPdf}>
      <div className="relative flex h-screen w-full overflow-hidden text-white font-sans bg-black">
        <LivingBackground
          imageUrl={background.imageUrl}
          nextImageUrl={background.nextImageUrl}
          isTransitioning={background.isTransitioning}
          gradient={background.gradient}
          nextGradient={background.nextGradient}
          awakeningZoom={
            // status !== "skip" (not status === "play") so the image is
            // already at scale(1.15) on first paint during the brief
            // "pending" period. Otherwise the transform animates 1 → 1.15
            // when status resolves, then immediately interrupts itself with
            // the 1.15 → 1 transition — cancelling out the zoom.
            awakening.status !== "skip" ? awakeningPhase === "playing" : undefined
          }
          awakeningZoomDurationMs={AWAKENING_REVEAL_MS}
        />
        <BackgroundScrim />

        {/* Cover mode only: black overlay above UI (z-30). Stays opaque for
            COVER_OPAQUE_MS (hiding UI + BG), then fades to transparent. UI
            shell below stays at opacity 1, so glass cards render at full
            quality throughout — no pop. */}
        {awakeningMode === "cover" && awakening.status !== "skip" && (
          <div
            className="absolute inset-0 z-[30] bg-black pointer-events-none transition-opacity ease-out"
            style={{
              opacity: uiRevealed ? 0 : 1,
              transitionDuration: `${COVER_FADE_MS}ms`,
            }}
          />
        )}

        {/* Window drag region — frameless title bar */}
        <div className="absolute inset-x-0 top-0 z-50 h-[52px] [-webkit-app-region:drag]" />

        {/* Main Layout Shell. Reveal behavior depends on awakeningMode:
            - "fade":  opacity 0 → 1 (glass pop at end due to Chromium)
            - "cover": opacity 1 always, cover above handles reveal
            - "snap":  visibility hidden → visible (no fade, no pop) */}
        <div
          className={`relative z-10 flex w-full h-full gap-4 p-4 pl-0${
            awakeningMode === "fade" ? " transition-opacity ease-out" : ""
          }`}
          style={
            awakeningMode === "fade"
              ? {
                  opacity: uiRevealed ? 1 : 0,
                  transitionDuration: `${AWAKENING_UI_FADE_MS}ms`,
                }
              : awakeningMode === "snap"
              ? { visibility: uiRevealed ? "visible" : "hidden" }
              : undefined
          }
        >
          {/* Left Column: Navigation */}
          <LeftNav
            isCollapsed={isDetailOpen || (location.pathname === "/scouts" && selectedScoutId !== null)}
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
            hasBrokenConnections={(brokenConnections?.count ?? 0) > 0}
            hasPendingUpdate={updateReady}
            onOpenSpotlight={() => {
              setSpotlightInitialAction("search");
              omnibar.open("spotlight");
            }}
            assistantName={assistantName}
            isAIWorking={omnibar.isStreaming}
          />

          <Routes>
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/calendar" element={<CalendarPage onEventClick={handleCalendarEventClick} />} />
            <Route path="/scouts" element={
              selectedScoutId && selectedScoutData ? (
                <ScoutDetail
                  scouts={scouts}
                  scout={selectedScoutData}
                  findings={scoutFindings}
                  activity={scoutActivity}
                  isLoadingFindings={isLoadingFindings}
                  isLoadingActivity={isLoadingActivity}
                  onSelectScout={handleSelectScout}
                  onBack={handleBackToRoster}
                  onPause={() => pauseScout.mutate(selectedScoutId)}
                  onResume={() => resumeScout.mutate(selectedScoutId)}
                  onUpdate={(data) => updateScout.mutate({ id: selectedScoutId, ...data })}
                  onTriggerRun={import.meta.env.DEV ? () => { triggerRun.mutate(selectedScoutId!); setScoutRunning(true); } : undefined}
                  isRunning={scoutRunning}
                  onClearHistory={import.meta.env.DEV ? () => clearHistory.mutate(selectedScoutId!) : undefined}
                  isClearing={clearHistory.isPending}
                  onConsolidate={import.meta.env.DEV ? () => triggerConsolidation.mutate(selectedScoutId!) : undefined}
                  isConsolidating={triggerConsolidation.isPending}
                  onDelete={() => { deleteScout.mutate(selectedScoutId!); setSelectedScoutId(null); }}
                  onClickFindingItem={(itemId) => {
                    const thing = allActiveThings.find((t) => t.id === itemId);
                    if (thing) {
                      handleItemClick(thing);
                    } else {
                      // Item may be completed/archived — open detail panel with minimal stub, it will fetch full data
                      handleItemClick({ id: itemId, title: "", type: "task", list: "", listId: null, status: "active", source: "", urgency: "later", isCompleted: false } as any);
                    }
                  }}
                  memories={scoutMemories}
                  isLoadingMemories={isLoadingMemories}
                  onDeleteMemory={(memoryId) => deleteMemory.mutate({ scoutId: selectedScoutId!, memoryId })}
                  assistantName={assistantName}
                />
              ) : (
                <ScoutsRoster
                  scouts={scouts}
                  onSelectScout={handleSelectScout}
                  isLoading={isLoadingScouts}
                  omnibarProps={scoutsOmnibarProps}
                  newScoutId={newScoutId}
                  recentFindings={recentFindingsData?.findings}
                  isLoadingFindings={isLoadingRecentFindings}
                  onFindingClick={(finding: RecentFindingItem) => {
                    if (finding.itemId) {
                      const thing = allActiveThings.find((t) => t.id === finding.itemId);
                      if (thing) {
                        handleItemClick(thing);
                      } else {
                        handleItemClick({ id: finding.itemId, title: finding.title, type: "content", list: "", listId: null, status: "active", source: "scout", urgency: "later", isCompleted: false } as any);
                      }
                    } else {
                      setSelectedScoutId(finding.scoutId);
                    }
                  }}
                />
              )
            } />
            <Route path="/today" element={
              <MainLayout onEventClick={handleItemClick} calendarEvents={sidebarCalendarEvents} isLoadingCalendar={isLoadingSidebarCalendar} showSidebar={showCalendarSidebar} onConnectCalendar={hasCalendarAccounts ? undefined : handleConnectCalendar} onDismissSidebar={hasCalendarAccounts ? undefined : handleDismissSidebar} sidebarDate={sidebarDate} onPrevDay={handleSidebarPrevDay} onNextDay={handleSidebarNextDay} onToday={handleSidebarToday} nextUpEvent={nextUpEvent} nextUpTimer={nextUpTimer} assistantName={assistantName}>
                <TodayView
                  lists={lists}
                  onItemClick={handleItemClick}
                  onTriageOpen={handleTriageOpen}
                  onFocusChange={handleFocusChange}
                  omnibarProps={omnibarProps}
                  nextUpEvent={nextUpEvent}
                  nextUpTimer={nextUpTimer}
                  onReconnect={handleReconnect}
                  reconnectPendingSourceId={reconnectPendingSourceId}
                  assistantName={assistantName}
                />
              </MainLayout>
            } />
            <Route path="/upcoming" element={
              <MainLayout onEventClick={handleItemClick} calendarEvents={sidebarCalendarEvents} isLoadingCalendar={isLoadingSidebarCalendar} showSidebar={showCalendarSidebar} onConnectCalendar={hasCalendarAccounts ? undefined : handleConnectCalendar} onDismissSidebar={hasCalendarAccounts ? undefined : handleDismissSidebar} sidebarDate={sidebarDate} onPrevDay={handleSidebarPrevDay} onNextDay={handleSidebarNextDay} onToday={handleSidebarToday} nextUpEvent={nextUpEvent} nextUpTimer={nextUpTimer} assistantName={assistantName}>
                <UpcomingView onItemClick={handleItemClick} onTriageOpen={handleTriageOpen} onFocusChange={handleFocusChange} onReconnect={handleReconnect} reconnectPendingSourceId={reconnectPendingSourceId} />
              </MainLayout>
            } />
            <Route path="/inbox" element={
              <MainLayout onEventClick={handleItemClick} calendarEvents={sidebarCalendarEvents} isLoadingCalendar={isLoadingSidebarCalendar} showSidebar={showCalendarSidebar} onConnectCalendar={hasCalendarAccounts ? undefined : handleConnectCalendar} onDismissSidebar={hasCalendarAccounts ? undefined : handleDismissSidebar} sidebarDate={sidebarDate} onPrevDay={handleSidebarPrevDay} onNextDay={handleSidebarNextDay} onToday={handleSidebarToday} nextUpEvent={nextUpEvent} nextUpTimer={nextUpTimer} assistantName={assistantName}>
                <InboxView
                  things={inboxData?.visible ?? []}
                  lists={lists}
                  onItemClick={handleItemClick}
                  onToggle={handleToggle}
                  onArchive={handleInboxArchive}
                  onAdd={handleInboxAdd}
                  onAddContent={handleInboxAddContent}
                  onTriage={handleInboxTriage}
                  onTriageOpen={handleTriageOpen}
                  onFocusChange={handleFocusChange}
                  onReconnect={handleReconnect}
                  reconnectPendingSourceId={reconnectPendingSourceId}
                  onInstallUpdate={installUpdate}
                  assistantName={assistantName}
                />
              </MainLayout>
            } />
            <Route path="/lists/:slug" element={
              <MainLayout onEventClick={handleItemClick} calendarEvents={sidebarCalendarEvents} isLoadingCalendar={isLoadingSidebarCalendar} showSidebar={showCalendarSidebar} onConnectCalendar={hasCalendarAccounts ? undefined : handleConnectCalendar} onDismissSidebar={hasCalendarAccounts ? undefined : handleDismissSidebar} sidebarDate={sidebarDate} onPrevDay={handleSidebarPrevDay} onNextDay={handleSidebarNextDay} onToday={handleSidebarToday} nextUpEvent={nextUpEvent} nextUpTimer={nextUpTimer} assistantName={assistantName}>
                <ListView lists={lists} archivedLists={archivedLists} listsFetching={listsFetching} onItemClick={handleItemClick} onArchiveList={handleArchiveList} onTriageOpen={handleTriageOpen} onFocusChange={handleFocusChange} onReconnect={handleReconnect} reconnectPendingSourceId={reconnectPendingSourceId} />
              </MainLayout>
            } />
            <Route path="/" element={<Navigate to="/today" replace />} />
            <Route path="*" element={
              <MainLayout onEventClick={handleItemClick} calendarEvents={sidebarCalendarEvents} isLoadingCalendar={isLoadingSidebarCalendar} showSidebar={showCalendarSidebar} onConnectCalendar={hasCalendarAccounts ? undefined : handleConnectCalendar} onDismissSidebar={hasCalendarAccounts ? undefined : handleDismissSidebar} sidebarDate={sidebarDate} onPrevDay={handleSidebarPrevDay} onNextDay={handleSidebarNextDay} onToday={handleSidebarToday} nextUpEvent={nextUpEvent} nextUpTimer={nextUpTimer} assistantName={assistantName}>
                <NotFoundView assistantName={assistantName} />
              </MainLayout>
            } />
          </Routes>
        </div>

        {/* Sliding Detail Panel Overlay */}
        <DetailPanel
          isOpen={isDetailOpen}
          item={selectedItem}
          onClose={handleCloseDetail}
          onBack={handleDetailBack}
          canGoBack={detailHistory.length > 0}
          onToggle={handleToggle}
          assistantName={assistantName}
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
          onSendBrettMessage={brett.sendMessage}
          onLoadMoreBrettMessages={brett.loadMore}
          isSendingBrettMessage={false}
          isBrettStreaming={brett.isStreaming}
          isLoadingMoreBrettMessages={brett.isLoadingMore}
          brettTotalCount={brett.totalCount}
          brettAiConfigured={brett.aiConfigured}
          onOpenSettings={() => navigate("/settings#ai-providers")}
          onRetryExtraction={() => {
            if (selectedId) retryExtraction.mutate(selectedId);
          }}
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
          onSendCalendarBrettMessage={calendarBrett.sendMessage}
          onLoadMoreCalendarBrettMessages={calendarBrett.loadMore}
          isSendingCalendarBrettMessage={false}
          isCalendarBrettStreaming={calendarBrett.isStreaming}
          isLoadingMoreCalendarBrettMessages={calendarBrett.isLoadingMore}
          calendarBrettAiConfigured={calendarBrett.aiConfigured}
          calendarRelatedItems={calendarRelatedItemsData?.relatedItems}
          calendarMeetingHistory={calendarMeetingHistoryData ?? null}
          meetingNote={meetingNote ? {
            id: meetingNote.id,
            title: meetingNote.title,
            summary: meetingNote.summary,
            transcript: meetingNote.transcript as any,
            actionItems: meetingNote.actionItems as any,
            items: meetingNote.items as any,
            meetingStartedAt: meetingNote.meetingStartedAt,
          } : null}
          onToggleActionItem={handleToggle}
          onSelectActionItem={(itemId) => {
            const existing = allActiveThings.find((t) => t.id === itemId);
            if (existing) {
              handleDetailDrillDown(existing);
            } else {
              const linked = meetingNote?.items?.find((i) => i.id === itemId);
              if (linked) {
                handleDetailDrillDown({
                  id: linked.id,
                  type: "task",
                  title: linked.title,
                  status: linked.status as any,
                  isCompleted: linked.status === "done",
                  source: "Granola",
                  list: "Inbox",
                  listId: null,
                  urgency: "normal",
                } as any);
              }
            }
          }}
          onReprocessActionItems={import.meta.env.DEV ? (meetingId) => reprocessMeeting.mutate(meetingId) : undefined}
          isReprocessing={reprocessMeeting.isPending}
          onNavigateToCalendarEvent={(calendarEventId) => {
            const event = sidebarCalendarEvents.find((e) => e.id === calendarEventId);
            if (event) {
              handleDetailDrillDown(event);
            } else {
              handleDetailDrillDown({
                id: calendarEventId,
                googleEventId: "",
                title: "",
                startTime: "",
                endTime: "",
                durationMinutes: 0,
                color: "blue",
                hasBrettContext: false,
                isAllDay: false,
                myResponseStatus: "needsAction",
              } as any);
            }
          }}
          onNavigateToScout={(scoutId) => {
            navigate("/scouts");
            setSelectedScoutId(scoutId);
            handleCloseDetail();
          }}
          onScoutFeedback={(scoutId, findingId, useful) =>
            submitFeedback.mutate({ scoutId, findingId, useful })
          }
          onApproveNewsletter={async (pendingId) => {
            await apiFetch(`/newsletters/senders/${pendingId}/approve`, { method: "POST" });
            queryClient.invalidateQueries({ queryKey: ["things"] });
            queryClient.invalidateQueries({ queryKey: ["inbox"] });
          }}
          onBlockNewsletter={async (pendingId) => {
            await apiFetch(`/newsletters/senders/${pendingId}/block`, { method: "POST" });
            queryClient.invalidateQueries({ queryKey: ["things"] });
            queryClient.invalidateQueries({ queryKey: ["inbox"] });
          }}
          onItemClick={(id) => {
            const thing = allActiveThings.find((t) => t.id === id);
            if (thing) handleDetailDrillDown(thing);
          }}
          onEventClick={(eventId) => {
            const event = sidebarCalendarEvents.find((e) => e.id === eventId);
            if (event) {
              handleDetailDrillDown(event);
            } else {
              handleDetailDrillDown({
                id: eventId,
                googleEventId: "",
                title: "",
                startTime: "",
                endTime: "",
                durationMinutes: 0,
                color: "blue",
                hasBrettContext: false,
                isAllDay: false,
                myResponseStatus: "needsAction",
              } as any);
            }
          }}
          onNavigate={(path) => {
            navigate(path);
          }}
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
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-2xl">
            <TriagePopup
              mode={triageState.mode}
              lists={lists}
              currentListId={triageState.currentListId}
              currentDueDate={triageState.currentDueDate}
              currentDueDatePrecision={triageState.currentDueDatePrecision}
              suggestedLists={listSuggestionsData?.suggestions}
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

        {/* Spotlight Modal (Cmd+K) */}
        <SpotlightModal
          isOpen={omnibar.isOpen && omnibar.mode === "spotlight"}
          input={omnibar.input}
          onInputChange={omnibar.setInput}
          messages={omnibar.messages}
          isStreaming={omnibar.isStreaming}
          hasAI={omnibar.hasAI}
          onSend={(text, intent) => omnibar.send(text, currentView, intent)}
          onCreateTask={(title: string) => omnibar.createTask(title, currentView)}
          onSearch={omnibar.searchThings}
          searchResults={omnibar.searchResults ?? null}
          isSearching={omnibar.isSearching}
          onSearchResultClick={(id: string) => {
            navigate("/inbox");
            omnibar.close();
          }}
          onClose={() => { setSpotlightInitialAction(null); omnibar.close(); }}
          onCancel={omnibar.cancel}
          onReset={omnibar.reset}
          onNavigateToSettings={() => navigate("/settings#ai-providers")}
          onItemClick={(id: string) => {
            setSelectedItem({ id, title: "", type: "task", list: "", listId: null, status: "active", source: "", urgency: "later", isCompleted: false } as any);
            setIsDetailOpen(true);
            omnibar.close();
          }}
          onEventClick={(eventId: string) => {
            const event = sidebarCalendarEvents.find((e) => e.id === eventId);
            if (event) {
              handleItemClick(event);
            } else {
              setSelectedItem({ id: eventId, googleEventId: "", title: "", startTime: "", endTime: "", durationMinutes: 0, color: "blue", hasBrettContext: false, isAllDay: false, myResponseStatus: "needsAction" } as any);
              setIsDetailOpen(true);
            }
            omnibar.close();
          }}
          onNavigate={(path: string) => {
            navigate(path);
            omnibar.close();
          }}
          sessionId={omnibar.sessionId}
          showTokenUsage={showTokenUsage}
          sessionUsage={sessionUsageData ?? null}
          initialForcedAction={spotlightInitialAction}
          showScoutAction={true}
          assistantName={assistantName}
        />

        {/* Calendar connect interstitial — meeting notes opt-in */}
        {showCalendarConnectModal && (
          <CalendarConnectModal
            onConnect={(meetingNotes) => {
              setShowCalendarConnectModal(false);
              connectCalendar.mutate(meetingNotes);
            }}
            onCancel={() => setShowCalendarConnectModal(false)}
            isPending={connectCalendar.isPending}
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

        {/* Feedback modal */}
        <FeedbackModal
          isOpen={feedbackOpen}
          onClose={() => setFeedbackOpen(false)}
          diagnostics={feedbackDiagnostics}
          screenshot={feedbackScreenshot}
          userId={user?.id || "unknown"}
        />

        {/* Dev-only awakening reveal mode toggle. Cycles fade → cover →
            snap, persists to localStorage, resets the session-played flag,
            and reloads so you can feel each variant. Hidden in prod. */}
        {import.meta.env.DEV && (
          <button
            type="button"
            className="fixed bottom-4 right-4 z-[9999] px-3 py-2 rounded-full bg-black/70 backdrop-blur-sm text-xs text-white/90 border border-white/10 hover:bg-black/85 transition-colors font-mono"
            style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
            onClick={() => {
              const next: Record<AwakeningRevealMode, AwakeningRevealMode> = {
                fade: "cover",
                cover: "snap",
                snap: "fade",
              };
              localStorage.setItem(REVEAL_MODE_KEY, next[awakeningMode]);
              _resetAwakeningSessionFlag();
              window.location.reload();
            }}
            title="Cycle: fade → cover → snap"
          >
            reveal: {awakeningMode}
          </button>
        )}
      </div>
      </AppDropZone>
    </DndContext>
  );
}
