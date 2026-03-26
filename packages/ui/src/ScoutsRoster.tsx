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
                {activeScouts.length} active, watching for you
              </p>
            </div>
          </div>

          <button className="flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 transition-all duration-200 text-white text-[13px] font-semibold shadow-[0_0_16px_rgba(59,130,246,0.25)] hover:shadow-[0_0_24px_rgba(59,130,246,0.4)]">
            <Plus size={15} />
            New Scout
          </button>
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

        {/* Completed */}
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
