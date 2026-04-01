import React, { useState, useRef } from "react";
import { useLocation } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { ProfileSection } from "./ProfileSection";
import { SecuritySection } from "./SecuritySection";
import { CalendarSection } from "./CalendarSection";
import { TimezoneSection } from "./TimezoneSection";
import { LocationSection } from "./LocationSection";
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
  | "memory"
  | "timezone-location"
  | "briefing"
  | "import"
  | "account";

const TABS: { id: SettingsTab; label: string }[] = [
  { id: "profile", label: "Profile" },
  { id: "security", label: "Security" },
  { id: "calendar", label: "Calendar" },
  { id: "ai-providers", label: "AI Providers" },
  { id: "memory", label: "Memory" },
  { id: "timezone-location", label: "Preferences" },
  { id: "briefing", label: "Briefing" },
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

interface SettingsLayoutProps {
  onBack: () => void;
}

export function SettingsLayout({ onBack }: SettingsLayoutProps) {
  const location = useLocation();
  const { user } = useAuth();

  const initialTab = tabFromHash(location.hash) || "profile";
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab);
  const [slideDirection, setSlideDirection] = useState<"left" | "right" | null>(
    null
  );
  const [isTransitioning, setIsTransitioning] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  function handleTabSelect(tab: SettingsTab) {
    if (tab === activeTab) return;

    const oldIndex = TABS.findIndex((t) => t.id === activeTab);
    const newIndex = TABS.findIndex((t) => t.id === tab);
    const direction = newIndex > oldIndex ? "left" : "right";

    setSlideDirection(direction);
    setIsTransitioning(true);

    requestAnimationFrame(() => {
      setActiveTab(tab);
      if (contentRef.current) {
        contentRef.current.scrollTop = 0;
      }
      setTimeout(() => {
        setIsTransitioning(false);
        setSlideDirection(null);
      }, 200);
    });
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
      case "memory":
        return <MemorySection />;
      case "timezone-location":
        return (
          <div className="space-y-5">
            <TimezoneSection />
            <LocationSection />
          </div>
        );
      case "briefing":
        return <BriefingSection />;
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

  // Slide animation: horizontal direction since tabs are horizontal
  const enterFrom =
    slideDirection === "left" ? "translate-x-3" : "-translate-x-3";
  const contentClasses = isTransitioning
    ? `opacity-0 ${enterFrom}`
    : "opacity-100 translate-x-0";

  return (
    <div className="flex-1 min-w-0 flex flex-col h-full">
      {/* Header */}
      <div className="px-10 pt-4 pb-0">
        <div className="flex items-center gap-3 mb-4">
          <button
            onClick={onBack}
            className="text-white/50 hover:text-white transition-colors p-1 rounded-lg hover:bg-white/5"
          >
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-xl font-semibold text-white">Settings</h1>
        </div>

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
        className="flex-1 min-w-0 overflow-y-auto scrollbar-hide"
      >
        <div className="max-w-4xl px-10 pt-6 pb-12">
          <div
            className={`transition-all duration-200 ease-out ${contentClasses}`}
          >
            <div className="space-y-5">{renderContent()}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
