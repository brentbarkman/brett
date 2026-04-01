import React, { useEffect } from "react";
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

interface SettingsPageProps {
  onBack: () => void;
}

export function SettingsPage({ onBack }: SettingsPageProps) {
  const location = useLocation();
  const { user } = useAuth();

  // Scroll to section if hash is present (e.g., /settings#ai-settings)
  useEffect(() => {
    if (location.hash) {
      const id = location.hash.slice(1);
      // Small delay to let the page render
      setTimeout(() => {
        document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
      }, 100);
    }
  }, [location.hash]);

  return (
    <main className="flex-1 min-w-0 overflow-y-auto scrollbar-hide py-2">
      <div className="max-w-4xl mx-auto w-full space-y-5 px-10 pb-12">
        {/* Header */}
        <div className="flex items-center gap-3 pt-2">
          <button
            onClick={onBack}
            className="text-white/50 hover:text-white transition-colors p-1 rounded-lg hover:bg-white/5"
          >
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-xl font-semibold text-white">Settings</h1>
        </div>

        {/* Section nav */}
        <div className="flex items-center gap-1 p-1 rounded-xl bg-white/5 border border-white/10 sticky top-0 z-10 backdrop-blur-xl">
          {[
            { label: "Profile", id: "profile" },
            { label: "Integrations", id: "integrations" },
            { label: "Preferences", id: "preferences" },
            { label: "AI & Memory", id: "ai-memory" },
            { label: "Account", id: "account" },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => document.getElementById(tab.id)?.scrollIntoView({ behavior: "smooth" })}
              className="px-3 py-1.5 rounded-lg text-xs font-medium text-white/50 hover:text-white hover:bg-white/10 transition-all"
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div id="profile">
          <div className="space-y-5">
            <ProfileSection />
            <SecuritySection />
          </div>
        </div>

        <div id="integrations">
          <div className="space-y-5">
            <CalendarSection />
          </div>
        </div>

        <div id="preferences">
          <div className="space-y-5">
            <TimezoneSection />
            <LocationSection />
            <BriefingSection />
          </div>
        </div>

        <div id="ai-memory">
          <div className="space-y-5">
            <AISection />
            <MemorySection />
          </div>
        </div>

        <div id="account">
          <div className="space-y-5">
            <ImportSection userId={user?.id ?? ""} />
            <SignOutSection />
            <DangerZoneSection />
          </div>
        </div>
      </div>
    </main>
  );
}
