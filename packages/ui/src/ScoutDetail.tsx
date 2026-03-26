import React, { useState } from "react";
import { Pencil, Pause, Zap, FileText, CircleCheck } from "lucide-react";
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

  return (
    <div className="flex flex-1 min-w-0 h-full">
      {/* Scout List (left narrow panel) */}
      <div className="w-[380px] flex-shrink-0 border-r border-white/[0.05] overflow-y-auto scrollbar-hide p-5 space-y-4">
        <button
          onClick={onBack}
          className="text-lg font-bold text-white hover:text-white/80 transition-colors"
        >
          Scouts
        </button>
        <div className="space-y-2">
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
      <div className="flex-1 min-w-0 overflow-y-auto scrollbar-hide p-8 space-y-6">
        {/* Header */}
        <div className="flex items-start gap-4">
          <div
            className="w-14 h-14 rounded-full flex items-center justify-center flex-shrink-0"
            style={{
              background: isCompleted
                ? "rgba(255,255,255,0.08)"
                : `linear-gradient(180deg, ${selectedScout.avatarGradient[0]}, ${selectedScout.avatarGradient[1]})`,
            }}
          >
            <span className={`text-2xl font-bold ${isCompleted ? "text-white/30" : "text-white"}`}>
              {selectedScout.avatarLetter}
            </span>
          </div>

          <div className="flex-1 min-w-0 space-y-1">
            <div className="flex items-center gap-3">
              <h2 className="text-xl font-bold text-white">{selectedScout.name}</h2>
              <StatusBadge status={selectedScout.status} />
            </div>
            {selectedScout.statusLine && (
              <p className="text-[13px] font-medium text-purple-400/70">
                {selectedScout.statusLine}
              </p>
            )}
          </div>

          <div className="flex gap-2 flex-shrink-0">
            <ActionButton icon={<Pencil size={14} />} label="Edit" />
            <ActionButton icon={<Pause size={14} />} label="Pause" />
          </div>
        </div>

        <div className="h-px bg-white/[0.05]" />

        {/* Config Grid */}
        <div className="space-y-4">
          <ConfigField label="GOAL" value={selectedScout.goal} />
          <div className="grid grid-cols-2 gap-8">
            <ConfigField label="SOURCES" value={selectedScout.sources} />
            <ConfigField label="SENSITIVITY" value={selectedScout.sensitivity} />
          </div>
          <div className="grid grid-cols-2 gap-8">
            <ConfigField
              label="CADENCE"
              value={
                selectedScout.cadenceCurrent
                  ? `Base: ${selectedScout.cadenceBase}\nCurrent: ${selectedScout.cadenceCurrent} (${selectedScout.cadenceReason})`
                  : selectedScout.cadenceBase
              }
            />
            <ConfigField
              label="BUDGET"
              value={`${selectedScout.budgetUsed} / ${selectedScout.budgetTotal} runs this month`}
            />
          </div>
        </div>

        <div className="h-px bg-white/[0.05]" />

        {/* Tabs */}
        <div className="flex gap-0">
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
          <div className="space-y-2">
            {scoutFindings.length > 0 ? (
              scoutFindings.map((finding) => (
                <FindingCard key={finding.id} finding={finding} />
              ))
            ) : (
              <p className="text-sm text-white/30 py-8 text-center">
                No findings yet. This scout is still monitoring.
              </p>
            )}
          </div>
        ) : (
          <p className="text-sm text-white/30 py-8 text-center">
            Activity log coming soon.
          </p>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: Scout["status"] }) {
  if (status === "active") {
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded bg-green-500/20 text-[11px] font-semibold text-green-500">
        <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
        Active
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-2.5 py-0.5 rounded bg-white/[0.06] text-[11px] font-semibold text-white/40">
      {status === "completed" ? "Completed" : status === "paused" ? "Paused" : "Expired"}
    </span>
  );
}

function ActionButton({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <button className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-white/[0.05] border border-white/[0.08] hover:bg-white/[0.08] transition-colors text-white/60 hover:text-white/80 text-xs font-medium">
      {icon}
      {label}
    </button>
  );
}

function ConfigField({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <div className="text-[10px] font-semibold tracking-wider text-white/30">{label}</div>
      <p className="text-[13px] text-white/60 leading-relaxed whitespace-pre-line">{value}</p>
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
        flex items-center gap-1.5 px-4 py-2 text-[13px] font-medium transition-colors
        ${isActive
          ? "text-white border-b-2 border-purple-500"
          : "text-white/40 hover:text-white/60"}
      `}
    >
      {label}
      {count !== undefined && (
        <span className="text-white/40 text-xs">{count}</span>
      )}
    </button>
  );
}

function FindingCard({ finding }: { finding: ScoutFinding }) {
  const iconConfig = {
    insight: { icon: <Zap size={14} />, bg: "bg-purple-500/15", color: "text-purple-400" },
    article: { icon: <FileText size={14} />, bg: "bg-blue-500/15", color: "text-blue-400" },
    task: { icon: <CircleCheck size={14} />, bg: "bg-amber-500/15", color: "text-amber-400" },
  }[finding.type];

  const typeLabel = {
    insight: "Insight",
    article: "Article",
    task: "Task",
  }[finding.type];

  return (
    <div className="flex gap-3 p-3.5 rounded-xl bg-white/[0.03] border border-white/[0.05]">
      <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${iconConfig.bg}`}>
        <span className={iconConfig.color}>{iconConfig.icon}</span>
      </div>
      <div className="flex-1 min-w-0 space-y-1">
        <h4 className="text-[13px] font-semibold text-white">{finding.title}</h4>
        <p className="text-xs text-white/50 leading-relaxed">{finding.description}</p>
        <span className="text-[11px] text-white/30">{typeLabel} · {finding.timestamp}</span>
      </div>
    </div>
  );
}
