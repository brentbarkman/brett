import React, { useState, useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import {
  SettingsSidebar,
  SettingsCategory,
  ALL_CATEGORIES,
} from "./SettingsSidebar";
import { ProfileSection } from "./ProfileSection";
import { SecuritySection } from "./SecuritySection";
import { CalendarSection } from "./CalendarSection";
import { TimezoneSection } from "./TimezoneSection";
import { LocationSection } from "./LocationSection";
import { BriefingSection } from "./BriefingSection";
import { AISection } from "./AISection";
import { MemorySection } from "./MemorySection";
import { ImportSection } from "./ImportSection";
import { DeleteAccountDialog } from "./DeleteAccountDialog";
import { useAuth } from "../auth/AuthContext";
import { authClient } from "../auth/auth-client";

interface SettingsLayoutProps {
  onBack: () => void;
}

function categoryFromHash(hash: string): SettingsCategory | null {
  const id = hash.slice(1); // remove '#'
  if (ALL_CATEGORIES.includes(id as SettingsCategory)) {
    return id as SettingsCategory;
  }
  return null;
}

export function SettingsLayout({ onBack }: SettingsLayoutProps) {
  const location = useLocation();
  const { user, signOut } = useAuth();

  const initialCategory = categoryFromHash(location.hash) || "profile";
  const [activeCategory, setActiveCategory] =
    useState<SettingsCategory>(initialCategory);
  const [slideDirection, setSlideDirection] = useState<"up" | "down" | null>(
    null
  );
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  function handleCategorySelect(category: SettingsCategory) {
    if (category === activeCategory) return;

    const oldIndex = ALL_CATEGORIES.indexOf(activeCategory);
    const newIndex = ALL_CATEGORIES.indexOf(category);
    const direction = newIndex > oldIndex ? "up" : "down";

    setSlideDirection(direction);
    setIsTransitioning(true);

    // After old content fades out, swap and slide in
    requestAnimationFrame(() => {
      setActiveCategory(category);
      // Reset scroll
      if (contentRef.current) {
        contentRef.current.scrollTop = 0;
      }
      // Allow the entering animation to play, then clear transition state
      setTimeout(() => {
        setIsTransitioning(false);
        setSlideDirection(null);
      }, 200);
    });
  }

  async function handleDeleteAccount() {
    const { error } = await authClient.deleteUser();
    if (error) {
      throw new Error(error.message || "Failed to delete account");
    }
    await signOut();
  }

  function renderContent() {
    switch (activeCategory) {
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
          <div className="space-y-3">
            <TimezoneSection />
            <LocationSection />
          </div>
        );
      case "briefing":
        return <BriefingSection />;
      case "import":
        return <ImportSection userId={user?.id ?? ""} />;
      default:
        return null;
    }
  }

  // Compute page title and subtitle
  const PAGE_META: Record<SettingsCategory, { title: string; subtitle: string }> = {
    profile: {
      title: "Profile",
      subtitle: "Your personal information and display settings",
    },
    security: {
      title: "Security",
      subtitle: "Password, passkeys, and sign-in methods",
    },
    calendar: {
      title: "Calendar",
      subtitle: "Connected calendars and integrations",
    },
    "ai-providers": {
      title: "AI Providers",
      subtitle: "Configure AI models and API keys",
    },
    memory: {
      title: "Memory",
      subtitle: "What Brett knows about you",
    },
    "timezone-location": {
      title: "Timezone & Location",
      subtitle: "Time, location, and weather preferences",
    },
    briefing: {
      title: "Briefing",
      subtitle: "Daily briefing preferences",
    },
    import: {
      title: "Import",
      subtitle: "Import data from other apps",
    },
  };

  const meta = PAGE_META[activeCategory];

  // Slide animation classes
  const enterFrom = slideDirection === "up" ? "translate-y-3" : "-translate-y-3";
  const contentClasses = isTransitioning
    ? `opacity-0 ${enterFrom}`
    : "opacity-100 translate-y-0";

  return (
    <div className="flex-1 min-w-0 flex h-full">
      <SettingsSidebar
        activeCategory={activeCategory}
        onCategorySelect={handleCategorySelect}
        onBack={onBack}
        onSignOut={signOut}
        onDeleteAccount={() => setDeleteDialogOpen(true)}
      />

      {/* Detail pane */}
      <div ref={contentRef} className="flex-1 min-w-0 overflow-y-auto scrollbar-hide bg-black/20 backdrop-blur-xl">
        <div className="max-w-[720px] mx-auto px-8 pt-5 pb-12">
          <div
            className={`transition-all duration-200 ease-out ${contentClasses}`}
          >
            <h1 className="text-[17px] font-semibold text-white">
              {meta.title}
            </h1>
            <p className="text-[11px] text-white/30 mt-1 mb-5">{meta.subtitle}</p>
            <div className="space-y-3">{renderContent()}</div>
          </div>
        </div>
      </div>

      <DeleteAccountDialog
        isOpen={deleteDialogOpen}
        onClose={() => setDeleteDialogOpen(false)}
        onConfirm={handleDeleteAccount}
      />
    </div>
  );
}
