import React from "react";
import { ArrowLeft, LogOut, Trash2 } from "lucide-react";

export type SettingsCategory =
  | "profile"
  | "security"
  | "calendar"
  | "ai-providers"
  | "memory"
  | "timezone-location"
  | "briefing"
  | "import";

interface SidebarGroup {
  label: string;
  items: { id: SettingsCategory; label: string }[];
}

const GROUPS: SidebarGroup[] = [
  {
    label: "Account",
    items: [
      { id: "profile", label: "Profile" },
      { id: "security", label: "Security" },
    ],
  },
  {
    label: "Connections",
    items: [{ id: "calendar", label: "Calendar" }],
  },
  {
    label: "Intelligence",
    items: [
      { id: "ai-providers", label: "AI Providers" },
      { id: "memory", label: "Memory" },
    ],
  },
  {
    label: "Preferences",
    items: [
      { id: "timezone-location", label: "Timezone & Location" },
      { id: "briefing", label: "Briefing" },
    ],
  },
  {
    label: "Data",
    items: [{ id: "import", label: "Import" }],
  },
];

// Flat ordered list for index-based direction tracking
export const ALL_CATEGORIES: SettingsCategory[] = GROUPS.flatMap((g) =>
  g.items.map((i) => i.id)
);

interface SettingsSidebarProps {
  activeCategory: SettingsCategory;
  onCategorySelect: (category: SettingsCategory) => void;
  onBack: () => void;
  onSignOut: () => void;
  onDeleteAccount: () => void;
}

export function SettingsSidebar({
  activeCategory,
  onCategorySelect,
  onBack,
  onSignOut,
  onDeleteAccount,
}: SettingsSidebarProps) {
  return (
    <div className="w-[200px] flex-shrink-0 bg-white/5 border-r border-white/5 flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 pt-4 pb-5">
        <button
          onClick={onBack}
          className="text-white/40 hover:text-white transition-colors p-0.5 rounded-md hover:bg-white/5"
        >
          <ArrowLeft size={16} />
        </button>
        <span className="text-sm font-semibold text-white">Settings</span>
      </div>

      {/* Category groups */}
      <div className="flex-1 overflow-y-auto scrollbar-hide px-2">
        {GROUPS.map((group, gi) => (
          <div key={group.label} className={gi > 0 ? "mt-4" : ""}>
            <div className="text-[8px] uppercase tracking-[1.5px] text-white/30 px-2.5 mb-2 font-semibold">
              {group.label}
            </div>
            <div className="space-y-0.5">
              {group.items.map((item) => (
                <button
                  key={item.id}
                  onClick={() => onCategorySelect(item.id)}
                  className={`w-full text-left text-[11px] px-2.5 py-[7px] rounded-md transition-colors ${
                    activeCategory === item.id
                      ? "bg-white/10 text-white/90"
                      : "text-white/40 hover:bg-white/5 hover:text-white/50"
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Bottom actions */}
      <div className="mt-auto px-2 pb-4 space-y-0.5">
        <div className="h-px bg-white/10 mx-2.5 mb-2" />
        <button
          onClick={onSignOut}
          className="w-full text-left text-[11px] px-2.5 py-[7px] rounded-md text-white/30 hover:bg-white/5 hover:text-white/50 transition-colors flex items-center gap-2"
        >
          <LogOut size={12} />
          Sign Out
        </button>
        <button
          onClick={onDeleteAccount}
          className="w-full text-left text-[11px] px-2.5 py-[7px] rounded-md text-red-400/60 hover:bg-red-500/10 hover:text-red-400 transition-colors flex items-center gap-2"
        >
          <Trash2 size={12} />
          Delete Account
        </button>
      </div>
    </div>
  );
}
