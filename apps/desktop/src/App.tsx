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
  ScoutsRoster,
  ScoutDetail,
} from "@brett/ui";
import type { Thing, CalendarEvent, Scout } from "@brett/types";
import { useAuth } from "./auth/AuthContext";
import {
  mockLists,
  mockThings,
  mockEvents,
  mockBriefingItems,
  mockScouts,
  mockScoutFindings,
} from "./data/mockData";

export function App() {
  const { user } = useAuth();
  const [activeFilter, setActiveFilter] = useState("All");
  const [isBriefingVisible, setIsBriefingVisible] = useState(true);
  const [selectedItem, setSelectedItem] = useState<
    Thing | CalendarEvent | null
  >(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [activePage, setActivePage] = useState<"today" | "inbox" | "scouts">("today");
  const [selectedScout, setSelectedScout] = useState<Scout | null>(null);

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

  const handleNavigate = (page: "today" | "inbox" | "scouts") => {
    setActivePage(page);
    setSelectedScout(null);
    setIsDetailOpen(false);
    setTimeout(() => setSelectedItem(null), 300);
  };

  const handleSelectScout = (scout: Scout) => {
    setSelectedScout(scout);
  };

  const handleBackToRoster = () => {
    setSelectedScout(null);
  };

  // Filter things based on active pill
  const filteredThings = mockThings.filter((thing) => {
    if (activeFilter === "All") return true;
    if (activeFilter === "Tasks") return thing.type === "task";
    if (activeFilter === "Notes") return false;
    if (activeFilter === "Scout") return thing.type === "scout";
    if (activeFilter === "Saved")
      return thing.type === "saved_web" || thing.type === "saved_tweet";
    if (activeFilter === "Reading") return thing.list === "Reading";
    return true;
  });

  const upNextEvent = mockEvents.find((e) => e.id === "e2");

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
        <LeftNav
          isCollapsed={isDetailOpen || (activePage === "scouts" && selectedScout !== null)}
          lists={mockLists}
          user={user}
          activePage={activePage}
          onNavigate={handleNavigate}
        />

        {activePage === "scouts" ? (
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
        ) : (
          <>
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

                <ThingsList things={filteredThings} onItemClick={handleItemClick} />
              </div>
            </main>

            {/* Right Column: Calendar */}
            <div className="w-[300px] flex-shrink-0 py-2">
              <CalendarTimeline
                events={mockEvents}
                onEventClick={handleItemClick}
              />
            </div>
          </>
        )}
      </div>

      {/* Sliding Detail Panel Overlay */}
      <DetailPanel
        isOpen={isDetailOpen}
        item={selectedItem}
        onClose={handleCloseDetail}
      />
    </div>
  );
}
