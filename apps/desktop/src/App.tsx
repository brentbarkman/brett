import React, { useEffect, useState, useCallback, useMemo } from "react";
import { Routes, Route, Navigate, useNavigate, useLocation } from "react-router-dom";
import { slugify, getEventGlassColor } from "@brett/utils";
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
} from "@brett/ui";
import type { Thing, CalendarEventDisplay, CalendarEventRecord, DueDatePrecision, ReminderType, RecurrenceType, Scout } from "@brett/types";
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
} from "./api/calendar";
import { useCalendarAccounts, useConnectCalendar } from "./api/calendar-accounts";
import { useGranolaMeetingForEvent, useReprocessMeetingActions } from "./api/granola";
import { useEventStream, useSSEHandler } from "./api/sse";
import { useTimezoneSync } from "./api/timezone";
import { useOmnibar } from "./api/omnibar";
import { useSessionUsage } from "./api/ai-usage";
import { usePreference } from "./api/preferences";
import { useWeather } from "./api/weather";
import { SettingsPage } from "./settings/SettingsPage";
import { TodayView } from "./views/TodayView";
import { ListView } from "./views/ListView";
import { UpcomingView } from "./views/UpcomingView";
import { NotFoundView } from "./views/NotFoundView";
import CalendarPage from "./pages/CalendarPage";
import {
  mockScouts,
  mockScoutFindings,
} from "./data/mockData";

const SIDEBAR_DISMISSED_KEY = "brett-calendar-sidebar-dismissed";

function MainLayout({ children, onEventClick, calendarEvents, isLoadingCalendar, showSidebar, onConnectCalendar, onDismissSidebar, sidebarDate, onPrevDay, onNextDay, onToday, nextUpEvent, nextUpTimer }: {
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
}) {
  // Show compact card in sidebar when not urgent (>10 min) or happening now
  const showCompactInSidebar = nextUpTimer && !nextUpTimer.isExpired && !(nextUpTimer.isUrgent && !nextUpTimer.isHappening);

  return (
    <>
      <main className="flex-1 min-w-0 overflow-y-auto scrollbar-hide py-2">
        <div className="max-w-3xl mx-auto w-full space-y-4">
          {children}
        </div>
      </main>
      {showSidebar && (
        <div className="w-[300px] flex-shrink-0 py-2 flex flex-col gap-3">
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
            <CalendarTimeline events={calendarEvents} onEventClick={onEventClick} isLoading={isLoadingCalendar} onConnect={onConnectCalendar} onDismiss={onDismissSidebar} date={sidebarDate} onPrevDay={onPrevDay} onNextDay={onNextDay} onToday={onToday} />
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
  useTimezoneSync();
  const [selectedItem, setSelectedItem] = useState<
    Thing | CalendarEventDisplay | null
  >(null);
  const [detailHistory, setDetailHistory] = useState<(Thing | CalendarEventDisplay)[]>([]);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [activePage, setActivePage] = useState<"today" | "inbox" | "scouts">("today");
  const [selectedScout, setSelectedScout] = useState<Scout | null>(null);

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

  const handleConnectCalendar = useCallback(() => {
    connectCalendar.mutate();
  }, [connectCalendar]);

  const handleDismissSidebar = useCallback(() => {
    setSidebarDismissed(true);
    localStorage.setItem(SIDEBAR_DISMISSED_KEY, "true");
  }, []);

  // Clear dismissed state when accounts are connected
  useEffect(() => {
    if (hasCalendarAccounts && sidebarDismissed) {
      setSidebarDismissed(false);
      localStorage.removeItem(SIDEBAR_DISMISSED_KEY);
    }
  }, [hasCalendarAccounts, sidebarDismissed]);

  // Today's date string (stable for the session — doesn't change when sidebar navigates)
  const todayStr = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }, []);

  // Sidebar calendar date navigation
  const [sidebarDate, setSidebarDate] = useState(() => new Date());
  const sidebarDateStr = useMemo(() => {
    const d = sidebarDate;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }, [sidebarDate]);

  const handleSidebarPrevDay = useCallback(() => {
    setSidebarDate((d) => { const n = new Date(d); n.setDate(n.getDate() - 1); return n; });
  }, []);
  const handleSidebarNextDay = useCallback(() => {
    setSidebarDate((d) => { const n = new Date(d); n.setDate(n.getDate() + 1); return n; });
  }, []);
  const handleSidebarToday = useCallback(() => {
    setSidebarDate(new Date());
  }, []);

  const { data: sidebarCalendarData, isLoading: isLoadingSidebarCalendar } = useCalendarEvents({ date: sidebarDateStr });
  const sidebarCalendarEvents: CalendarEventDisplay[] = useMemo(
    () => (sidebarCalendarData?.events ?? []).filter((e: CalendarEventRecord) => !e.isAllDay).map(recordToDisplay),
    [sidebarCalendarData],
  );

  // Today's events for Next Up — always pinned to today, independent of sidebar navigation
  const { data: todayCalendarData } = useCalendarEvents({ date: todayStr });
  const todayCalendarEvents: CalendarEventDisplay[] = useMemo(
    () => (todayCalendarData?.events ?? []).filter((e: CalendarEventRecord) => !e.isAllDay).map(recordToDisplay),
    [todayCalendarData],
  );

  // Next Up: find the next upcoming event from TODAY (not the sidebar date)
  const nextUpEvent = useMemo(() => {
    if (!todayCalendarEvents.length) return null;
    const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
    return todayCalendarEvents.find((e) => {
      if (e.myResponseStatus === "declined" || e.isAllDay) return false;
      return parseTimeToMinutes(e.endTime) > nowMin;
    }) ?? null;
  }, [todayCalendarEvents]);
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
  const reprocessMeeting = useReprocessMeetingActions();
  const updateRsvp = useUpdateRsvp();
  const updateCalendarNotes = useUpdateCalendarEventNotes();
  const calendarBrett = useBrettChat({
    calendarEventId: isDetailOpen && isCalendarSelected ? selectedId : null,
  });

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

  // Omnibar state (shared between bar and spotlight)
  const omnibar = useOmnibar();

  // Weather state for omnibar pill
  const { weather, isLoading: weatherLoading } = useWeather();
  const [showWeatherExpanded, setShowWeatherExpanded] = useState(false);

  // Token usage tracking — reactive to Settings toggle
  const [showTokenUsage] = usePreference("showTokenUsage");
  const { data: sessionUsageData } = useSessionUsage(
    showTokenUsage ? omnibar.sessionId : null,
  );

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
      if ((e.metaKey || e.ctrlKey) && e.key === "f") {
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
  }, [omnibar.isOpen, omnibar.mode, omnibar.close, omnibar.open]);

  // Build omnibar props for the bar component
  const currentView = useMemo(() => {
    const path = location.pathname;
    if (path === "/today") return "today";
    if (path === "/upcoming") return "upcoming";
    if (path === "/inbox") return "inbox";
    if (path === "/calendar") return "calendar";
    if (path === "/settings") return "settings";
    if (path === "/scouts") return "scouts";
    if (path.startsWith("/lists/")) return `list:${path.split("/lists/")[1]}`;
    return undefined;
  }, [location.pathname]);

  const omnibarProps = useMemo(
    () => ({
      isOpen: omnibar.isOpen && omnibar.mode === "bar",
      input: omnibar.input,
      onInputChange: omnibar.setInput,
      messages: omnibar.messages,
      isStreaming: omnibar.isStreaming,
      hasAI: omnibar.hasAI,
      onSend: (text: string) => omnibar.send(text, currentView),
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
      searchResults: omnibar.searchResults?.map((t) => ({ id: t.id, title: t.title, status: t.status, type: t.type, contentType: t.contentType, listName: t.list || null })) ?? null,
      isSearching: omnibar.isSearching,
      onSearchResultClick: (id: string) => {
        const item = omnibar.searchResults?.find((t) => t.id === id);
        if (item) {
          // Navigate to the view where this item lives
          if (item.listId && item.list) {
            navigate(`/lists/${slugify(item.list)}`);
          } else if (item.urgency === "overdue" || item.urgency === "today") {
            navigate("/today");
          } else {
            navigate("/inbox");
          }
          // Open detail panel after a tick so the view renders first
          setTimeout(() => handleItemClick(item), 50);
          omnibar.close();
        }
      },
      onClose: () => { omnibar.close(); setShowWeatherExpanded(false); },
      onOpen: () => { omnibar.open("bar"); setSelectedItem(null); setIsDetailOpen(false); },
      onCancel: omnibar.cancel,
      onReset: omnibar.reset,
      onNavigateToSettings: () => navigate("/settings#ai-settings"),
      sessionId: omnibar.sessionId,
      showTokenUsage,
      sessionUsage: sessionUsageData ?? null,
      weather,
      weatherLoading,
      showWeatherExpanded,
      onWeatherClick: () => setShowWeatherExpanded((prev) => !prev),
    }),
    [omnibar.isOpen, omnibar.mode, omnibar.input, omnibar.messages, omnibar.isStreaming, omnibar.hasAI, omnibar.send, omnibar.createTask, omnibar.searchThings, omnibar.searchResults, omnibar.isSearching, omnibar.close, omnibar.open, omnibar.cancel, omnibar.reset, omnibar.setInput, currentView, navigate, omnibar.sessionId, showTokenUsage, sessionUsageData, weather, weatherLoading, showWeatherExpanded]
  );

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
  const handleCalendarEventClick = useCallback((event: CalendarEventRecord) => {
    handleItemClick(recordToDisplay(event));
  }, []);

  // Update panel when keyboard nav changes focus (only if panel is open)
  const handleFocusChange = useCallback((thing: Thing) => {
    if (isDetailOpen) {
      setSelectedItem(thing);
    }
  }, [isDetailOpen]);

  const handleCloseDetail = useCallback(() => {
    setIsDetailOpen(false);
    setDetailHistory([]);
    setTimeout(() => setSelectedItem(null), 300);
  }, []);

  useSSEHandler("calendar.event.deleted", useCallback((data: { eventId: string }) => {
    if (selectedItem && selectedItem.id === data.eventId) {
      handleCloseDetail();
    }
  }, [selectedItem, handleCloseDetail]));

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

  // Scout handlers
  const handleSelectScout = (scout: Scout) => {
    setSelectedScout(scout);
  };

  const handleBackToRoster = () => {
    setSelectedScout(null);
  };

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

  const handleDropPdf = useCallback((file: File) => {
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
  }, [createThing, uploadAttachment]);

  const inboxCount = inboxData?.visible.length ?? 0;

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <AppDropZone onDropPdf={handleDropPdf}>
      <div className="relative flex h-screen w-full overflow-hidden text-white font-sans bg-black">
        {/* Full-bleed Photographic Background */}
        <div
          className="absolute inset-0 z-0 bg-cover bg-center opacity-80"
          style={{
            backgroundImage:
              'url("https://images.unsplash.com/photo-1633306593834-92cf7af67d2f?w=1920&q=80")',
          }}
        />

        {/* Vignette overlay for better text readability */}
        <div className="absolute inset-0 z-0 bg-gradient-to-b from-black/40 via-transparent to-black/60 pointer-events-none" />

        {/* Left-side scrim for nav readability over any background */}
        <div className="absolute inset-y-0 left-0 w-[312px] z-0 bg-gradient-to-r from-black/60 to-transparent pointer-events-none" />

        {/* Main Layout Shell */}
        <div className="relative z-10 flex w-full h-full gap-4 p-4 pl-0">
          {/* Left Column: Navigation */}
          <LeftNav
            isCollapsed={isDetailOpen || (location.pathname === "/scouts" && selectedScout !== null)}
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
            <Route path="/scouts" element={
              selectedScout ? (
                <ScoutDetail
                  scouts={mockScouts}
                  selectedScout={selectedScout}
                  findings={mockScoutFindings}
                  onSelectScout={handleSelectScout}
                  onBack={handleBackToRoster}
                />
              ) : (
                <ScoutsRoster
                  scouts={mockScouts}
                  onSelectScout={handleSelectScout}
                />
              )
            } />
            <Route path="/today" element={
              <MainLayout onEventClick={handleItemClick} calendarEvents={sidebarCalendarEvents} isLoadingCalendar={isLoadingSidebarCalendar} showSidebar={showCalendarSidebar} onConnectCalendar={hasCalendarAccounts ? undefined : handleConnectCalendar} onDismissSidebar={hasCalendarAccounts ? undefined : handleDismissSidebar} sidebarDate={sidebarDate} onPrevDay={handleSidebarPrevDay} onNextDay={handleSidebarNextDay} onToday={handleSidebarToday} nextUpEvent={nextUpEvent} nextUpTimer={nextUpTimer}>
                <TodayView
                  lists={lists}
                  onItemClick={handleItemClick}
                  onTriageOpen={handleTriageOpen}
                  onFocusChange={handleFocusChange}
                  omnibarProps={omnibarProps}
                  nextUpEvent={nextUpEvent}
                  nextUpTimer={nextUpTimer}
                />
              </MainLayout>
            } />
            <Route path="/upcoming" element={
              <MainLayout onEventClick={handleItemClick} calendarEvents={sidebarCalendarEvents} isLoadingCalendar={isLoadingSidebarCalendar} showSidebar={showCalendarSidebar} onConnectCalendar={hasCalendarAccounts ? undefined : handleConnectCalendar} onDismissSidebar={hasCalendarAccounts ? undefined : handleDismissSidebar} sidebarDate={sidebarDate} onPrevDay={handleSidebarPrevDay} onNextDay={handleSidebarNextDay} onToday={handleSidebarToday} nextUpEvent={nextUpEvent} nextUpTimer={nextUpTimer}>
                <UpcomingView onItemClick={handleItemClick} onTriageOpen={handleTriageOpen} onFocusChange={handleFocusChange} />
              </MainLayout>
            } />
            <Route path="/inbox" element={
              <MainLayout onEventClick={handleItemClick} calendarEvents={sidebarCalendarEvents} isLoadingCalendar={isLoadingSidebarCalendar} showSidebar={showCalendarSidebar} onConnectCalendar={hasCalendarAccounts ? undefined : handleConnectCalendar} onDismissSidebar={hasCalendarAccounts ? undefined : handleDismissSidebar} sidebarDate={sidebarDate} onPrevDay={handleSidebarPrevDay} onNextDay={handleSidebarNextDay} onToday={handleSidebarToday} nextUpEvent={nextUpEvent} nextUpTimer={nextUpTimer}>
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
                />
              </MainLayout>
            } />
            <Route path="/lists/:slug" element={
              <MainLayout onEventClick={handleItemClick} calendarEvents={sidebarCalendarEvents} isLoadingCalendar={isLoadingSidebarCalendar} showSidebar={showCalendarSidebar} onConnectCalendar={hasCalendarAccounts ? undefined : handleConnectCalendar} onDismissSidebar={hasCalendarAccounts ? undefined : handleDismissSidebar} sidebarDate={sidebarDate} onPrevDay={handleSidebarPrevDay} onNextDay={handleSidebarNextDay} onToday={handleSidebarToday} nextUpEvent={nextUpEvent} nextUpTimer={nextUpTimer}>
                <ListView lists={lists} archivedLists={archivedLists} listsFetching={listsFetching} onItemClick={handleItemClick} onArchiveList={handleArchiveList} onTriageOpen={handleTriageOpen} onFocusChange={handleFocusChange} />
              </MainLayout>
            } />
            <Route path="/" element={<Navigate to="/today" replace />} />
            <Route path="*" element={
              <MainLayout onEventClick={handleItemClick} calendarEvents={sidebarCalendarEvents} isLoadingCalendar={isLoadingSidebarCalendar} showSidebar={showCalendarSidebar} onConnectCalendar={hasCalendarAccounts ? undefined : handleConnectCalendar} onDismissSidebar={hasCalendarAccounts ? undefined : handleDismissSidebar} sidebarDate={sidebarDate} onPrevDay={handleSidebarPrevDay} onNextDay={handleSidebarNextDay} onToday={handleSidebarToday} nextUpEvent={nextUpEvent} nextUpTimer={nextUpTimer}>
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
          onBack={handleDetailBack}
          canGoBack={detailHistory.length > 0}
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
          onSendBrettMessage={brett.sendMessage}
          onLoadMoreBrettMessages={brett.loadMore}
          isSendingBrettMessage={false}
          isBrettStreaming={brett.isStreaming}
          isLoadingMoreBrettMessages={brett.isLoadingMore}
          brettTotalCount={brett.totalCount}
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

        {/* Spotlight Modal (Cmd+K) */}
        <SpotlightModal
          isOpen={omnibar.isOpen && omnibar.mode === "spotlight"}
          input={omnibar.input}
          onInputChange={omnibar.setInput}
          messages={omnibar.messages}
          isStreaming={omnibar.isStreaming}
          hasAI={omnibar.hasAI}
          onSend={(text) => omnibar.send(text, currentView)}
          onCreateTask={(title: string) => omnibar.createTask(title, currentView)}
          onSearch={omnibar.searchThings}
          searchResults={omnibar.searchResults?.map((t) => ({ id: t.id, title: t.title, status: t.status, type: t.type, contentType: t.contentType, listName: t.list || null })) ?? null}
          isSearching={omnibar.isSearching}
          onSearchResultClick={(id: string) => {
            const item = omnibar.searchResults?.find((t) => t.id === id);
            if (item) {
              if (item.listId && item.list) {
                navigate(`/lists/${slugify(item.list)}`);
              } else if (item.urgency === "overdue" || item.urgency === "today") {
                navigate("/today");
              } else {
                navigate("/inbox");
              }
              setTimeout(() => handleItemClick(item), 50);
              omnibar.close();
            }
          }}
          onClose={() => { setSpotlightInitialAction(null); omnibar.close(); }}
          onCancel={omnibar.cancel}
          onReset={omnibar.reset}
          onNavigateToSettings={() => navigate("/settings#ai-settings")}
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
        />

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
      </AppDropZone>
    </DndContext>
  );
}
