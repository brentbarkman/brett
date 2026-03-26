import React, { useState } from "react";
import { Pencil, Pause, Zap, FileText, CircleCheck, ArrowLeft } from "lucide-react";
import type { Scout, ScoutFinding } from "@brett/types";
import { ScoutCard } from "./ScoutCard";

interface ScoutDetailProps {
  scouts: Scout[];
  selectedScout: Scout;
  findings: ScoutFinding[];
  onSelectScout: (scout: Scout) => void;
  onBack: () => void;
}

export function ScoutDetail({
  scouts,
  selectedScout,
  findings,
  onSelectScout,
  onBack,
}: ScoutDetailProps) {
  const [activeTab, setActiveTab] = useState<"findings" | "log">("findings");
  const scoutFindings = findings.filter((f) => f.scoutId === selectedScout.id);
  const isCompleted = selectedScout.status === "completed" || selectedScout.status === "expired";
  const budgetPercent = Math.round((selectedScout.budgetUsed / selectedScout.budgetTotal) * 100);

  return (
    <div className="flex flex-1 min-w-0 h-full">
      {/* Scout List Panel */}
      <div className="w-[340px] flex-shrink-0 bg-black/30 backdrop-blur-xl border-r border-white/[0.06] overflow-y-auto scrollbar-hide p-5 space-y-4">
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-sm font-semibold text-white/60 hover:text-white transition-colors"
        >
          <ArrowLeft size={16} />
          All Scouts
        </button>
        <div className="space-y-1.5">
          {scouts.map((scout) => (
            <ScoutCard
              key={scout.id}
              scout={scout}
              onClick={() => onSelectScout(scout)}
              isSelected={scout.id === selectedScout.id}
              variant="compact"
            />
          ))}
        </div>
      </div>

      {/* Detail Panel */}
      <div className="flex-1 min-w-0 overflow-y-auto scrollbar-hide bg-black/20 backdrop-blur-lg">
        {/* Header with gradient accent */}
        <div className="relative overflow-hidden">
          {/* Ambient color from scout avatar */}
          {!isCompleted && (
            <div
              className="absolute top-0 left-0 w-full h-48 opacity-[0.06] pointer-events-none"
              style={{
                background: `radial-gradient(ellipse at 20% 0%, ${selectedScout.avatarGradient[0]}, transparent 70%)`,
              }}
            />
          )}

          <div className="relative z-10 p-8 pb-0 space-y-6">
            {/* Scout Identity */}
            <div className="flex items-start gap-5">
              {/* Large avatar with glow */}
              <div className="relative flex-shrink-0">
                <div
                  className="w-16 h-16 rounded-2xl flex items-center justify-center relative z-10"
                  style={{
                    background: isCompleted
                      ? "rgba(255,255,255,0.06)"
                      : `linear-gradient(135deg, ${selectedScout.avatarGradient[0]}, ${selectedScout.avatarGradient[1]})`,
                  }}
                >
                  <span className={`text-2xl font-bold ${isCompleted ? "text-white/30" : "text-white"}`}>
                    {selectedScout.avatarLetter}
                  </span>
                </div>
                {!isCompleted && (
                  <div
                    className="absolute inset-0 rounded-2xl blur-xl opacity-40"
                    style={{ background: selectedScout.avatarGradient[0] }}
                  />
                )}
              </div>

              <div className="flex-1 min-w-0 space-y-1.5">
                <div className="flex items-center gap-3">
                  <h2 className="text-xl font-bold text-white">{selectedScout.name}</h2>
                  <StatusBadge status={selectedScout.status} />
                </div>
                {selectedScout.statusLine && (
                  <p className="text-[13px] font-medium text-purple-400/80">
                    {selectedScout.statusLine}
                  </p>
                )}
                {selectedScout.endDate && (
                  <p className="text-[12px] text-white/30">
                    Ended {selectedScout.endDate}
                  </p>
                )}
              </div>

              <div className="flex gap-2 flex-shrink-0">
                <ActionButton icon={<Pencil size={14} />} label="Edit" />
                <ActionButton icon={<Pause size={14} />} label="Pause" />
              </div>
            </div>

            {/* Goal callout */}
            <div className="rounded-xl bg-white/[0.04] border border-white/[0.06] p-4">
              <p className="text-[13px] text-white/70 leading-relaxed">{selectedScout.goal}</p>
            </div>
          </div>
        </div>

        <div className="px-8 py-6 space-y-6">
          {/* Config Grid */}
          <div className="grid grid-cols-2 gap-5">
            <ConfigCard label="SOURCES" value={selectedScout.sources} />
            <ConfigCard label="SENSITIVITY" value={selectedScout.sensitivity} />
            <ConfigCard
              label="CADENCE"
              value={
                selectedScout.cadenceCurrent
                  ? `Base: ${selectedScout.cadenceBase}\nCurrent: ${selectedScout.cadenceCurrent} (${selectedScout.cadenceReason})`
                  : selectedScout.cadenceBase
              }
              accent={!!selectedScout.cadenceCurrent}
            />
            <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-4 space-y-3">
              <div className="text-[10px] font-semibold tracking-widest text-white/30 uppercase">Budget</div>
              <div className="flex items-baseline gap-2">
                <span className="text-lg font-bold text-white">{selectedScout.budgetUsed}</span>
                <span className="text-sm text-white/30">/ {selectedScout.budgetTotal} runs</span>
              </div>
              {/* Progress bar */}
              <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${budgetPercent}%`,
                    background: budgetPercent > 80
                      ? "linear-gradient(90deg, #F59E0B, #EF4444)"
                      : budgetPercent > 50
                        ? "linear-gradient(90deg, #8B5CF6, #A78BFA)"
                        : "linear-gradient(90deg, #22C55E, #4ADE80)",
                  }}
                />
              </div>
              <div className="text-[11px] text-white/30">{budgetPercent}% used this month</div>
            </div>
          </div>

          {/* Divider */}
          <div className="h-px bg-white/[0.06]" />

          {/* Tabs */}
          <div className="flex gap-1 bg-white/[0.03] rounded-lg p-1 w-fit">
            <TabButton
              label="Findings"
              count={scoutFindings.length}
              isActive={activeTab === "findings"}
              onClick={() => setActiveTab("findings")}
            />
            <TabButton
              label="Activity Log"
              isActive={activeTab === "log"}
              onClick={() => setActiveTab("log")}
            />
          </div>

          {/* Tab Content */}
          {activeTab === "findings" ? (
            <div className="space-y-2.5">
              {scoutFindings.length > 0 ? (
                scoutFindings.map((finding) => (
                  <FindingCard key={finding.id} finding={finding} />
                ))
              ) : (
                <div className="text-center py-12 space-y-2">
                  <p className="text-sm text-white/30">No findings yet.</p>
                  <p className="text-xs text-white/20">This scout is still monitoring.</p>
                </div>
              )}
            </div>
          ) : (
            <div className="text-center py-12 space-y-2">
              <p className="text-sm text-white/30">Activity log coming soon.</p>
              <p className="text-xs text-white/20">Every run, finding, and cadence change will be logged here.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: Scout["status"] }) {
  if (status === "active") {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-500/15 text-[11px] font-semibold text-emerald-400 border border-emerald-500/20">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
        Active
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full bg-white/[0.06] text-[11px] font-semibold text-white/40 border border-white/[0.06]">
      {status === "completed" ? "Completed" : status === "paused" ? "Paused" : "Expired"}
    </span>
  );
}

function ActionButton({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <button className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-white/[0.05] border border-white/[0.08] hover:bg-white/[0.10] hover:border-white/[0.15] transition-all duration-200 text-white/60 hover:text-white text-xs font-medium">
      {icon}
      {label}
    </button>
  );
}

function ConfigCard({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={`rounded-xl bg-white/[0.03] border p-4 space-y-2 ${accent ? "border-purple-500/15" : "border-white/[0.06]"}`}>
      <div className="text-[10px] font-semibold tracking-widest text-white/30 uppercase">{label}</div>
      <p className={`text-[13px] leading-relaxed whitespace-pre-line ${accent ? "text-white/70" : "text-white/50"}`}>{value}</p>
    </div>
  );
}

function TabButton({
  label,
  count,
  isActive,
  onClick,
}: {
  label: string;
  count?: number;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`
        flex items-center gap-1.5 px-4 py-2 rounded-md text-[13px] font-medium transition-all duration-200
        ${isActive
          ? "bg-white/[0.08] text-white shadow-sm"
          : "text-white/40 hover:text-white/60"}
      `}
    >
      {label}
      {count !== undefined && (
        <span className={`text-xs ${isActive ? "text-white/50" : "text-white/30"}`}>{count}</span>
      )}
    </button>
  );
}

function FindingCard({ finding }: { finding: ScoutFinding }) {
  const iconConfig = {
    insight: { icon: <Zap size={14} />, bg: "bg-purple-500/15", color: "text-purple-400", border: "border-purple-500/10" },
    article: { icon: <FileText size={14} />, bg: "bg-blue-500/15", color: "text-blue-400", border: "border-blue-500/10" },
    task: { icon: <CircleCheck size={14} />, bg: "bg-amber-500/15", color: "text-amber-400", border: "border-amber-500/10" },
  }[finding.type];

  const typeLabel = {
    insight: "Insight",
    article: "Article",
    task: "Task",
  }[finding.type];

  return (
    <div className={`flex gap-3.5 p-4 rounded-xl bg-white/[0.03] border ${iconConfig.border} hover:bg-white/[0.05] transition-colors cursor-pointer`}>
      <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${iconConfig.bg}`}>
        <span className={iconConfig.color}>{iconConfig.icon}</span>
      </div>
      <div className="flex-1 min-w-0 space-y-1">
        <h4 className="text-[13px] font-semibold text-white">{finding.title}</h4>
        <p className="text-xs text-white/45 leading-relaxed">{finding.description}</p>
        <span className="text-[11px] text-white/25 font-medium">{typeLabel} · {finding.timestamp}</span>
      </div>
    </div>
  );
}
