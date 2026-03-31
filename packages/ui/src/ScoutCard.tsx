import React from "react";
import type { Scout } from "@brett/types";
import { humanizeCadence } from "@brett/utils";

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
          flex items-center gap-3 w-full p-3 rounded-xl transition-all duration-200 text-left
          ${isSelected
            ? "bg-white/[0.08] border border-blue-500/25 shadow-[0_0_12px_rgba(59,130,246,0.06)]"
            : "bg-white/[0.03] border border-transparent hover:bg-white/[0.06]"}
        `}
      >
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
          style={{
            background: isCompleted
              ? "rgba(255,255,255,0.08)"
              : `linear-gradient(180deg, ${scout.avatarGradient[0]}, ${scout.avatarGradient[1]})`,
            boxShadow: isCompleted ? "none" : `0 0 8px ${scout.avatarGradient[0]}30`,
          }}
        >
          <span className={`text-sm font-bold ${isCompleted ? "text-white/30" : "text-white"}`}>
            {scout.avatarLetter}
          </span>
        </div>
        <div className="flex-1 min-w-0">
          <div className={`text-[13px] font-medium truncate ${isSelected ? "text-white" : "text-white/50"}`}>
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
        group flex items-center gap-5 w-full p-5 rounded-2xl transition-all duration-200 text-left
        bg-white/[0.04] backdrop-blur-md border border-white/[0.07]
        hover:bg-white/[0.07] hover:border-white/[0.12] hover:shadow-[0_4px_24px_rgba(0,0,0,0.3)]
        ${isCompleted ? "opacity-50" : ""}
      `}
    >
      {/* Avatar with ambient glow */}
      <div className="relative flex-shrink-0">
        <div
          className="w-12 h-12 rounded-full flex items-center justify-center relative z-10"
          style={{
            background: isCompleted
              ? "rgba(255,255,255,0.06)"
              : `linear-gradient(135deg, ${scout.avatarGradient[0]}, ${scout.avatarGradient[1]})`,
          }}
        >
          <span className={`text-lg font-bold ${isCompleted ? "text-white/30" : "text-white"}`}>
            {scout.avatarLetter}
          </span>
        </div>
        {!isCompleted && (
          <div
            className="absolute inset-0 rounded-full blur-lg opacity-30 group-hover:opacity-50 transition-opacity"
            style={{ background: scout.avatarGradient[0] }}
          />
        )}
      </div>

      <div className="flex-1 min-w-0 space-y-1.5">
        <div className="flex items-center gap-2.5">
          <span className="text-[15px] font-semibold text-white truncate">{scout.name}</span>
          <StatusBadge status={scout.status} />
        </div>
        <p className="text-[13px] text-white/30 line-clamp-1">{scout.goal}</p>
        <div className="flex items-center gap-3 text-[11px] text-white/30 font-medium">
          <span>Last run: {scout.lastRun ?? "Never"}</span>
          <span className="text-white/10">·</span>
          <span>{scout.findingsCount} findings</span>
          <span className="text-white/10">·</span>
          <span className={scout.cadenceCurrentIntervalHours < scout.cadenceIntervalHours ? "text-blue-400/70" : ""}>
            {scout.cadenceCurrentIntervalHours < scout.cadenceIntervalHours
              ? `${humanizeCadence(scout.cadenceCurrentIntervalHours)} (elevated)`
              : humanizeCadence(scout.cadenceIntervalHours)}
          </span>
        </div>
      </div>
    </button>
  );
}

function StatusBadge({ status }: { status: Scout["status"] }) {
  if (status === "active") {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/15 text-[10px] font-semibold text-emerald-400 border border-emerald-500/15">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
        Active
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/[0.06] text-[10px] font-semibold text-white/30 border border-white/[0.04]">
      {status === "completed" ? "Completed" : status === "paused" ? "Paused" : "Expired"}
    </span>
  );
}
