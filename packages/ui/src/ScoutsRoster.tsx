import React from "react";
import { Plus, Radar } from "lucide-react";
import type { Scout } from "@brett/types";
import { formatRelativeTime } from "@brett/utils";
import { ScoutCard } from "./ScoutCard";
import { Omnibar, type OmnibarProps } from "./Omnibar";
import { RecentFindingsPanel, type RecentFindingItem } from "./RecentFindingsPanel";

const SCOUT_PLACEHOLDERS = [
  "Track new research on a topic you care about...",
  "Monitor a company's earnings and SEC filings...",
  "Get alerted when a podcast guest mentions your field...",
  "Follow price drops on something you want to buy...",
  "Stay on top of a competitor's product launches...",
];

interface ScoutsRosterProps {
  scouts: Scout[];
  onSelectScout: (scout: Scout) => void;
  onNewScout?: () => void;
  isLoading?: boolean;
  omnibarProps?: OmnibarProps;
  newScoutId?: string | null;
  recentFindings?: RecentFindingItem[];
  isLoadingFindings?: boolean;
  onFindingClick?: (finding: RecentFindingItem) => void;
}

export function ScoutsRoster({ scouts, onSelectScout, onNewScout, isLoading, omnibarProps, newScoutId, recentFindings, isLoadingFindings, onFindingClick }: ScoutsRosterProps) {
  const activeScouts = scouts.filter((s) => s.status === "active" || s.status === "paused");
  const inactiveScouts = scouts.filter((s) => s.status === "completed" || s.status === "expired");

  const totalFindings = scouts.reduce((sum, s) => sum + s.findingsCount, 0);
  const lastActivity = scouts
    .filter(s => s.lastRun)
    .sort((a, b) => new Date(b.lastRun!).getTime() - new Date(a.lastRun!).getTime())[0];

  return (
    <div className="flex-1 min-w-0 flex h-full gap-4 py-2 pr-4">
      {/* Scout list — scrolls independently */}
      <div className="flex-1 min-w-0 overflow-y-auto scrollbar-hide">
        <div className="flex flex-col gap-4 pb-20">
          {/* Glass card container — matches ItemListShell pattern */}
          <div className="bg-black/30 backdrop-blur-xl rounded-xl border border-white/10 p-4">
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
              <div>
                <h1 className="text-base font-semibold text-white">Scouts</h1>
                <p className="text-[11px] text-white/40 mt-0.5">
                  {isLoading ? "Loading..." : `${activeScouts.length} active · ${totalFindings} findings${lastActivity ? ` · Last run ${formatRelativeTime(lastActivity.lastRun!)}` : ''}`}
                </p>
              </div>

              {!omnibarProps && onNewScout && (
                <button
                  onClick={onNewScout}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 transition-all duration-200 text-white/60 hover:text-white text-[12px] font-medium"
                >
                  <Plus size={14} />
                  New Scout
                </button>
              )}
            </div>

            {/* Inline scout creation */}
            {omnibarProps && (
              <div className="mb-4">
                <Omnibar
                  {...omnibarProps}
                  placeholder={scouts.length < 3 ? SCOUT_PLACEHOLDERS[Math.floor(Date.now() / 60000) % SCOUT_PLACEHOLDERS.length] : "What do you want to scout?"}
                  showScoutAction
                />
              </div>
            )}

            {/* Loading skeleton */}
            {isLoading && (
              <div className="space-y-2">
                {[1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className="h-[72px] rounded-xl bg-white/5 animate-pulse"
                  />
                ))}
              </div>
            )}

            {/* Empty state */}
            {!isLoading && scouts.length === 0 && (
              <div className="flex flex-col items-center justify-center py-16 space-y-4">
                <div className="w-12 h-12 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center">
                  <Radar size={20} className="text-white/30" />
                </div>
                <div className="text-center space-y-1">
                  <p className="text-[14px] font-semibold text-white/50">No scouts yet</p>
                  <p className="text-[12px] text-white/30">Create a scout to start tracking anything on the internet.</p>
                </div>
                <button
                  onClick={omnibarProps?.onOpen ?? onNewScout}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white/10 hover:bg-white/15 transition-all duration-200 text-white/60 hover:text-white text-[12px] font-medium"
                >
                  <Plus size={14} />
                  Create your first Scout
                </button>
              </div>
            )}

            {/* Active / Paused Scouts */}
            {!isLoading && activeScouts.length > 0 && (
              <div className="space-y-2">
                {activeScouts.map((scout) => (
                  <ScoutCard
                    key={scout.id}
                    scout={scout}
                    onClick={() => onSelectScout(scout)}
                    isNew={scout.id === newScoutId}
                  />
                ))}
              </div>
            )}

            {/* Completed / Expired */}
            {!isLoading && inactiveScouts.length > 0 && (
              <div className={`space-y-2 ${activeScouts.length > 0 ? "mt-6" : ""}`}>
                <h3 className="text-[10px] uppercase tracking-[0.15em] font-semibold text-white/40 px-1">
                  Completed
                </h3>
                {inactiveScouts.map((scout) => (
                  <ScoutCard
                    key={scout.id}
                    scout={scout}
                    onClick={() => onSelectScout(scout)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Recent findings panel */}
      {recentFindings !== undefined && (
        <div className="flex-shrink-0">
          <RecentFindingsPanel
            findings={recentFindings}
            onFindingClick={onFindingClick}
            isLoading={isLoadingFindings}
          />
        </div>
      )}
    </div>
  );
}
