import React from "react";
import { Plus } from "lucide-react";
import type { Scout } from "@brett/types";
import { ScoutCard } from "./ScoutCard";

interface ScoutsRosterProps {
  scouts: Scout[];
  onSelectScout: (scout: Scout) => void;
}

export function ScoutsRoster({ scouts, onSelectScout }: ScoutsRosterProps) {
  return (
    <div className="flex-1 min-w-0 overflow-y-auto scrollbar-hide py-2">
      <div className="max-w-3xl mx-auto w-full space-y-6 px-10 py-8">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-white">Scouts</h1>
          <button className="flex items-center gap-2 px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 transition-colors text-white text-[13px] font-semibold">
            <Plus size={16} />
            New Scout
          </button>
        </div>

        <p className="text-sm text-white/50">
          Your scouts monitor the world and surface what matters.
        </p>

        <div className="space-y-3">
          {scouts.map((scout) => (
            <ScoutCard
              key={scout.id}
              scout={scout}
              onClick={() => onSelectScout(scout)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
