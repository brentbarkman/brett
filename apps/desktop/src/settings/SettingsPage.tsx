import React from "react";
import { ArrowLeft } from "lucide-react";
import { ProfileSection } from "./ProfileSection";
import { SecuritySection } from "./SecuritySection";
import { CalendarSection } from "./CalendarSection";
import { AISection } from "./AISection";
import { MemorySection } from "./MemorySection";
import { SignOutSection } from "./SignOutSection";
import { DangerZoneSection } from "./DangerZoneSection";

interface SettingsPageProps {
  onBack: () => void;
}

export function SettingsPage({ onBack }: SettingsPageProps) {
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
        <AISection />
        <MemorySection />
        <SignOutSection />
        <DangerZoneSection />
      </div>
    </main>
  );
}
