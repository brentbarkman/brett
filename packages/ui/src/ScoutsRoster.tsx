import React from "react";
import { Plus, Radar } from "lucide-react";
import type { Scout } from "@brett/types";
import { formatRelativeTime } from "@brett/utils";
import { ScoutCard } from "./ScoutCard";
import { Omnibar, type OmnibarProps } from "./Omnibar";

interface ScoutsRosterProps {
  scouts: Scout[];
  onSelectScout: (scout: Scout) => void;
  onNewScout?: () => void;
  isLoading?: boolean;
  omnibarProps?: OmnibarProps;
  newScoutId?: string | null;
}

export function ScoutsRoster({ scouts, onSelectScout, onNewScout, isLoading, omnibarProps, newScoutId }: ScoutsRosterProps) {
  const activeScouts = scouts.filter((s) => s.status === "active" || s.status === "paused");
  const inactiveScouts = scouts.filter((s) => s.status === "completed" || s.status === "expired");

  const totalFindings = scouts.reduce((sum, s) => sum + s.findingsCount, 0);
  const lastActivity = scouts
    .filter(s => s.lastRun)
    .sort((a, b) => new Date(b.lastRun!).getTime() - new Date(a.lastRun!).getTime())[0];

  return (
    <div className="flex-1 min-w-0 overflow-y-auto scrollbar-hide py-2">
      <div className="max-w-4xl mx-auto w-full px-10 py-6 space-y-6">
        {/* Header — lightweight, content-forward */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-white">Scouts</h1>
            <p className="text-[12px] text-white/50">
              {isLoading ? "Loading..." : `${activeScouts.length} active · ${totalFindings} findings${lastActivity ? ` · Last run ${formatRelativeTime(lastActivity.lastRun!)}` : ''}`}
            </p>
          </div>

          {!omnibarProps && onNewScout && (
            <button
              onClick={onNewScout}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 transition-all duration-200 text-white text-[13px] font-semibold shadow-[0_0_16px_rgba(59,130,246,0.25)] hover:shadow-[0_0_24px_rgba(59,130,246,0.4)]"
            >
              <Plus size={15} />
              New Scout
            </button>
          )}
        </div>

        {/* Inline scout creation */}
        {omnibarProps && (
          <Omnibar
            {...omnibarProps}
            placeholder="What do you want to scout?"
            showScoutAction
          />
        )}

        {/* Ghost examples when omnibar is closed and few scouts exist */}
        {omnibarProps && !omnibarProps.isOpen && scouts.length < 3 && (
          <div className="flex items-center gap-3 px-2 -mt-2">
            <span className="text-[11px] text-white/30">Try:</span>
            <span className="text-[11px] text-white/20 italic">"Track SEC filings for AAPL"</span>
            <span className="text-white/20">&middot;</span>
            <span className="text-[11px] text-white/20 italic">"Monitor competitor pricing"</span>
          </div>
        )}

        {/* Loading skeleton */}
        {isLoading && (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-[88px] rounded-2xl bg-white/5 border border-white/10 animate-pulse"
              />
            ))}
          </div>
        )}

        {/* Empty state */}
        {!isLoading && scouts.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 space-y-4">
            <div className="w-14 h-14 rounded-2xl bg-blue-500/10 border border-blue-500/10 flex items-center justify-center">
              <Radar size={24} className="text-blue-400/50" />
            </div>
            <div className="text-center space-y-1">
              <p className="text-[15px] font-semibold text-white/50">No scouts yet</p>
              <p className="text-[13px] text-white/30">Create a scout to start tracking anything on the internet.</p>
            </div>
            <button
              onClick={omnibarProps?.onOpen ?? onNewScout}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 transition-all duration-200 text-white text-[13px] font-semibold shadow-[0_0_16px_rgba(59,130,246,0.25)]"
            >
              <Plus size={15} />
              Create your first Scout
            </button>
          </div>
        )}

        {/* Active / Paused Scouts */}
        {!isLoading && activeScouts.length > 0 && (
          <div className="space-y-3">
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
          <div className="space-y-3">
            <h3 className="font-mono text-[11px] font-semibold tracking-wider text-white/40 uppercase px-1">
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
  );
}
