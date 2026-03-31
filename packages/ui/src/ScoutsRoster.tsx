import React from "react";
import { Plus, Radar } from "lucide-react";
import type { Scout } from "@brett/types";
import { ScoutCard } from "./ScoutCard";
import { Omnibar, type OmnibarProps } from "./Omnibar";

interface ScoutsRosterProps {
  scouts: Scout[];
  onSelectScout: (scout: Scout) => void;
  onNewScout?: () => void;
  isLoading?: boolean;
  omnibarProps?: OmnibarProps;
}

export function ScoutsRoster({ scouts, onSelectScout, onNewScout, isLoading, omnibarProps }: ScoutsRosterProps) {
  const activeScouts = scouts.filter((s) => s.status === "active" || s.status === "paused");
  const inactiveScouts = scouts.filter((s) => s.status === "completed" || s.status === "expired");

  return (
    <div className="flex-1 min-w-0 overflow-y-auto scrollbar-hide bg-black/20 backdrop-blur-lg rounded-2xl border border-white/[0.06] my-2 mr-4">
      <div className="max-w-3xl mx-auto w-full px-10 py-8 space-y-6">
        {/* Header — lightweight, content-forward */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-500/15 border border-blue-500/15 flex items-center justify-center">
              <Radar size={18} className="text-blue-400" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-white">Scouts</h1>
              <p className="text-[12px] text-white/30">
                {isLoading ? "Loading..." : `${activeScouts.length} active, watching for you`}
              </p>
            </div>
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
            placeholder="What do you want to monitor?"
            showScoutAction
          />
        )}

        {/* Loading skeleton */}
        {isLoading && (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-[88px] rounded-2xl bg-white/[0.04] border border-white/[0.07] animate-pulse"
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
              <p className="text-[13px] text-white/30">Create a scout to start monitoring anything on the internet.</p>
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
              />
            ))}
          </div>
        )}

        {/* Completed / Expired */}
        {!isLoading && inactiveScouts.length > 0 && (
          <div className="space-y-3">
            <h3 className="text-[11px] font-semibold tracking-widest text-white/25 uppercase px-1">
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
