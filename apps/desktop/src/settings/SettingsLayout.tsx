import React, { useState, useRef } from "react";
import { useLocation } from "react-router-dom";
import { ProfileSection } from "./ProfileSection";
import { SecuritySection } from "./SecuritySection";
import { CalendarSection } from "./CalendarSection";
import { TimezoneSection } from "./TimezoneSection";
import { LocationSection } from "./LocationSection";
import { BackgroundSection } from "./BackgroundSection";
import { BriefingSection } from "./BriefingSection";
import { AISection } from "./AISection";
import { MemorySection } from "./MemorySection";
import { ImportSection } from "./ImportSection";
import { SignOutSection } from "./SignOutSection";
import { DangerZoneSection } from "./DangerZoneSection";
import { useAuth } from "../auth/AuthContext";

type SettingsTab =
  | "profile"
  | "security"
  | "calendar"
  | "ai-providers"
  | "timezone-location"
  | "import"
  | "account";

const TABS: { id: SettingsTab; label: string }[] = [
  { id: "profile", label: "Profile" },
  { id: "security", label: "Security" },
  { id: "calendar", label: "Calendar" },
  { id: "ai-providers", label: "AI Providers" },
  { id: "timezone-location", label: "Personalize" },
  { id: "import", label: "Import" },
  { id: "account", label: "Account" },
];

function tabFromHash(hash: string): SettingsTab | null {
  const id = hash.slice(1);
  if (TABS.some((t) => t.id === id)) {
    return id as SettingsTab;
  }
  return null;
}

export function SettingsLayout() {
  const location = useLocation();
  const { user } = useAuth();

  const initialTab = tabFromHash(location.hash) || "profile";
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab);
  // "exiting" = old content sliding out, "entering" = new content sliding in
  const [phase, setPhase] = useState<"idle" | "exiting" | "entering">("idle");
  const [direction, setDirection] = useState<"left" | "right">("left");
  const contentRef = useRef<HTMLDivElement>(null);

  function handleTabSelect(tab: SettingsTab) {
    if (tab === activeTab || phase !== "idle") return;

    const oldIndex = TABS.findIndex((t) => t.id === activeTab);
    const newIndex = TABS.findIndex((t) => t.id === tab);
    const dir = newIndex > oldIndex ? "left" : "right";

    setDirection(dir);
    // Phase 1: slide old content out
    setPhase("exiting");

    setTimeout(() => {
      // Swap content and position off-screen on entering side
      setActiveTab(tab);
      if (contentRef.current) {
        contentRef.current.scrollTop = 0;
      }
      setPhase("entering");

      // Phase 2: slide new content in on next frame
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setPhase("idle");
        });
      });
    }, 150);
  }

  function renderContent() {
    switch (activeTab) {
      case "profile":
        return <ProfileSection />;
      case "security":
        return <SecuritySection />;
      case "calendar":
        return <CalendarSection />;
      case "ai-providers":
        return <AISection />;
      case "timezone-location":
        return (
          <div className="space-y-5">
            <BriefingSection />
            <TimezoneSection />
            <LocationSection />
            <MemorySection />
            <BackgroundSection />
          </div>
        );
      case "import":
        return <ImportSection userId={user?.id ?? ""} />;
      case "account":
        return (
          <div className="space-y-5">
            <SignOutSection />
            <DangerZoneSection />
          </div>
        );
      default:
        return null;
    }
  }

  // Carousel: exit one side, enter from the other
  let contentClasses: string;
  let useTransition = true;
  if (phase === "exiting") {
    // Slide old content out
    contentClasses = direction === "left" ? "-translate-x-full opacity-100" : "translate-x-full opacity-100";
  } else if (phase === "entering") {
    // Position new content off-screen instantly (no transition)
    contentClasses = direction === "left" ? "translate-x-full opacity-100" : "-translate-x-full opacity-100";
    useTransition = false;
  } else {
    // Idle: content at rest
    contentClasses = "translate-x-0 opacity-100";
  }

  return (
    <div className="flex-1 min-w-0 flex flex-col h-full">
      {/* Header */}
      <div className="max-w-4xl px-10 pt-4 pb-0">
        <h1 className="text-xl font-semibold text-white mb-4">Settings</h1>

        {/* Tab bar */}
        <div className="flex items-center gap-0 border-b border-white/10">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => handleTabSelect(tab.id)}
              className={`px-4 py-2.5 text-xs font-medium transition-colors relative ${
                activeTab === tab.id
                  ? "text-white"
                  : "text-white/40 hover:text-white/60"
              }`}
            >
              {tab.label}
              {activeTab === tab.id && (
                <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-blue-500" />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Content area */}
      <div
        ref={contentRef}
        className="flex-1 min-w-0 overflow-x-hidden overflow-y-auto scrollbar-hide"
      >
        <div className="max-w-4xl px-10 pt-6 pb-12">
          <div
            className={`${useTransition ? "transition-all duration-150 ease-out" : ""} ${contentClasses}`}
          >
            <div className="space-y-5">{renderContent()}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
