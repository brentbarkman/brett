import React, { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { ProfileSection } from "./ProfileSection";
import { SecuritySection } from "./SecuritySection";
import { CalendarSection } from "./CalendarSection";
import { TimezoneSection } from "./TimezoneSection";
import { AISection } from "./AISection";
import { MemorySection } from "./MemorySection";
import { SignOutSection } from "./SignOutSection";
import { DangerZoneSection } from "./DangerZoneSection";

interface SettingsPageProps {
  onBack: () => void;
}

export function SettingsPage({ onBack }: SettingsPageProps) {
  const location = useLocation();

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
      <div className="max-w-xl mx-auto w-full space-y-5 px-4 pb-12">
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

        <ProfileSection />
        <SecuritySection />
        <CalendarSection />
        <TimezoneSection />
        <AISection />
        <MemorySection />
        <SignOutSection />
        <DangerZoneSection />
      </div>
    </main>
  );
}
