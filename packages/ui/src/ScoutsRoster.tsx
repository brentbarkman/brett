import React from "react";
import { Plus, Radar } from "lucide-react";
import type { Scout } from "@brett/types";
import { ScoutCard } from "./ScoutCard";

interface ScoutsRosterProps {
  scouts: Scout[];
  onSelectScout: (scout: Scout) => void;
}

export function ScoutsRoster({ scouts, onSelectScout }: ScoutsRosterProps) {
  const activeScouts = scouts.filter((s) => s.status === "active");
  const inactiveScouts = scouts.filter((s) => s.status !== "active");

  return (
    <div className="flex-1 min-w-0 overflow-y-auto scrollbar-hide bg-black/20 backdrop-blur-lg rounded-2xl border border-white/[0.06] my-2 mr-4">
      <div className="max-w-3xl mx-auto w-full px-10 py-8 space-y-8">
        {/* Hero Header */}
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-purple-600/20 via-black/40 to-black/60 backdrop-blur-xl border border-purple-500/10 p-8">
          {/* Ambient glow */}
          <div className="absolute top-0 right-0 w-64 h-64 bg-purple-500/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/4 pointer-events-none" />

          <div className="relative z-10 flex items-start justify-between">
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-purple-500/20 border border-purple-500/20 flex items-center justify-center">
                  <Radar size={20} className="text-purple-400" />
                </div>
                <h1 className="text-2xl font-bold text-white">Scouts</h1>
              </div>
              <p className="text-sm text-white/50 max-w-md">
                Your scouts monitor the world and surface what matters.
                {activeScouts.length > 0 && (
                  <span className="text-purple-400/70"> {activeScouts.length} active, watching for you.</span>
                )}
              </p>
            </div>

            <button className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 transition-all duration-200 text-white text-[13px] font-semibold shadow-[0_0_20px_rgba(139,92,246,0.3)] hover:shadow-[0_0_30px_rgba(139,92,246,0.5)]">
              <Plus size={16} />
              New Scout
            </button>
          </div>
        </div>

        {/* Active Scouts */}
        {activeScouts.length > 0 && (
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

        {/* Completed / Inactive Scouts */}
        {inactiveScouts.length > 0 && (
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
