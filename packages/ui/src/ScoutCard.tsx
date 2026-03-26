import React from "react";
import type { Scout } from "@brett/types";

interface ScoutCardProps {
  scout: Scout;
  onClick: () => void;
  isSelected?: boolean;
  variant?: "full" | "compact";
}

export function ScoutCard({ scout, onClick, isSelected, variant = "full" }: ScoutCardProps) {
  const isCompleted = scout.status === "completed" || scout.status === "expired";

  if (variant === "compact") {
    return (
      <button
        onClick={onClick}
        className={`
          flex items-center gap-3 w-full p-3 rounded-xl transition-colors text-left
          ${isSelected ? "bg-white/[0.06] border border-purple-500/25" : "bg-white/[0.02] border border-transparent hover:bg-white/[0.04]"}
        `}
      >
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
          style={{
            background: isCompleted
              ? "rgba(255,255,255,0.08)"
              : `linear-gradient(180deg, ${scout.avatarGradient[0]}, ${scout.avatarGradient[1]})`,
          }}
        >
          <span className={`text-sm font-bold ${isCompleted ? "text-white/30" : "text-white"}`}>
            {scout.avatarLetter}
          </span>
        </div>
        <div className="flex-1 min-w-0">
          <div className={`text-[13px] font-medium truncate ${isSelected ? "text-white" : "text-white/60"}`}>
            {scout.name}
          </div>
          <div className="text-[11px] text-white/30">
            {scout.status === "active" ? "Active" : scout.status === "completed" ? "Completed" : scout.status === "paused" ? "Paused" : "Expired"} · {scout.findingsCount} findings
          </div>
        </div>
      </button>
    );
  }

  return (
    <button
      onClick={onClick}
      className={`
        flex items-center gap-4 w-full p-4 rounded-xl transition-colors text-left
        bg-white/[0.03] border border-white/[0.05] hover:bg-white/[0.06] hover:border-white/[0.08]
        ${isCompleted ? "opacity-60" : ""}
      `}
    >
      <div
        className="w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0"
        style={{
          background: isCompleted
            ? "rgba(255,255,255,0.08)"
            : `linear-gradient(180deg, ${scout.avatarGradient[0]}, ${scout.avatarGradient[1]})`,
        }}
      >
        <span className={`text-lg font-bold ${isCompleted ? "text-white/30" : "text-white"}`}>
          {scout.avatarLetter}
        </span>
      </div>

      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-white truncate">{scout.name}</span>
          <StatusBadge status={scout.status} />
        </div>
        <p className="text-xs text-white/50 line-clamp-2">{scout.goal}</p>
        <div className="flex items-center gap-3 text-[11px] text-white/30">
          <span>Last run: {scout.lastRun ?? "Never"}</span>
          <span className="text-white/15">·</span>
          <span>{scout.findingsCount} findings</span>
          <span className="text-white/15">·</span>
          <span className={scout.cadenceCurrent ? "text-purple-400" : ""}>
            {scout.cadenceCurrent
              ? `${scout.cadenceCurrent} (elevated)`
              : scout.cadenceBase}
          </span>
        </div>
      </div>
    </button>
  );
}

function StatusBadge({ status }: { status: Scout["status"] }) {
  if (status === "active") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-green-500/20 text-[10px] font-semibold text-green-500">
        <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
        Active
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-white/[0.06] text-[10px] font-semibold text-white/40">
      {status === "completed" ? "Completed" : status === "paused" ? "Paused" : "Expired"}
    </span>
  );
}
