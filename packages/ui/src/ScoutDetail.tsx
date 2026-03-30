import React, { useState } from "react";
import { Pencil, Pause, Zap, FileText, CircleCheck, ArrowLeft, ExternalLink, Check, X, MessageSquare, Minus, Plus } from "lucide-react";
import type { Scout, ScoutFinding, ScoutSource } from "@brett/types";
import { ScoutCard } from "./ScoutCard";

function humanizeCadence(hours: number): string {
  if (hours < 24) return hours === 1 ? "Every hour" : `Every ${hours}h`;
  const days = hours / 24;
  if (days === 1) return "Daily";
  if (days === 7) return "Weekly";
  return `Every ${days}d`;
}

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
  const [editingField, setEditingField] = useState<string | null>(null);
  const scoutFindings = findings.filter((f) => f.scoutId === selectedScout.id);
  const isCompleted = selectedScout.status === "completed" || selectedScout.status === "expired";
  const budgetPercent = Math.round((selectedScout.budgetUsed / selectedScout.budgetTotal) * 100);

  return (
    <div className="flex flex-1 min-w-0 h-full gap-4 py-2 pr-4">
      {/* Scout List Panel */}
      <div className="w-[340px] flex-shrink-0 bg-black/30 backdrop-blur-xl rounded-2xl border border-white/[0.06] overflow-y-auto scrollbar-hide p-5 space-y-4">
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-sm font-semibold text-white/50 hover:text-white transition-colors"
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
      <div className="flex-1 min-w-0 overflow-y-auto scrollbar-hide bg-black/20 backdrop-blur-lg rounded-2xl border border-white/[0.06]">
        {/* Header */}
        <div className="relative overflow-hidden">
          {/* Subtle ambient from scout color */}
          {!isCompleted && (
            <div
              className="absolute top-0 left-0 w-full h-40 opacity-[0.04] pointer-events-none"
              style={{
                background: `radial-gradient(ellipse at 15% 0%, ${selectedScout.avatarGradient[0]}, transparent 60%)`,
              }}
            />
          )}

          <div className="relative z-10 p-8 pb-6 space-y-5">
            {/* Identity row */}
            <div className="flex items-start gap-5">
              <div className="relative flex-shrink-0">
                <div
                  className="w-14 h-14 rounded-2xl flex items-center justify-center relative z-10"
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
                    className="absolute inset-0 rounded-2xl blur-xl opacity-30"
                    style={{ background: selectedScout.avatarGradient[0] }}
                  />
                )}
              </div>

              <div className="flex-1 min-w-0 space-y-1">
                <div className="flex items-center gap-3">
                  <h2 className="text-xl font-bold text-white">{selectedScout.name}</h2>
                  <StatusBadge status={selectedScout.status} />
                </div>
                {selectedScout.statusLine && (
                  <p className="text-[13px] font-medium text-blue-400/70">
                    {selectedScout.statusLine}
                  </p>
                )}
                {selectedScout.endDate && (
                  <p className="text-[12px] text-white/30">Ended {selectedScout.endDate}</p>
                )}
              </div>

              <button className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-white/[0.05] border border-white/[0.08] hover:bg-white/[0.10] hover:border-white/[0.15] transition-all text-white/50 hover:text-white text-xs font-medium flex-shrink-0">
                <Pause size={14} />
                Pause
              </button>
            </div>

            {/* Goal — the primary field, given prominence */}
            <EditableCard
              label="GOAL"
              isEditing={editingField === "goal"}
              onEdit={() => setEditingField("goal")}
              onCancel={() => setEditingField(null)}
              editType="brett"
            >
              <p className="text-[14px] text-white/90 leading-relaxed">{selectedScout.goal}</p>
            </EditableCard>
          </div>
        </div>

        <div className="px-8 pb-8 space-y-5">
          {/* Config Grid — supporting details */}
          <div className="grid grid-cols-2 gap-4">
            {/* Sources */}
            <EditableCard
              label="SOURCES"
              isEditing={editingField === "sources"}
              onEdit={() => setEditingField("sources")}
              onCancel={() => setEditingField(null)}
              editType="brett"
            >
              <div className="flex flex-wrap gap-1.5">
                {selectedScout.sources.map((source) =>
                  source.url ? (
                    <a
                      key={source.name}
                      href={source.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white/[0.04] border border-white/[0.06] text-[11px] text-blue-400/80 hover:text-blue-300 hover:border-blue-500/20 transition-all"
                    >
                      {source.name}
                      <ExternalLink size={9} className="opacity-40" />
                    </a>
                  ) : (
                    <span
                      key={source.name}
                      className="inline-flex items-center px-2 py-0.5 rounded-md bg-white/[0.03] border border-white/[0.04] text-[11px] text-white/30"
                    >
                      {source.name}
                    </span>
                  )
                )}
              </div>
            </EditableCard>

            {/* Sensitivity */}
            <EditableCard
              label="SENSITIVITY"
              isEditing={editingField === "sensitivity"}
              onEdit={() => setEditingField("sensitivity")}
              onCancel={() => setEditingField(null)}
              onSave={() => setEditingField(null)}
              editType="inline"
            >
              {editingField === "sensitivity" ? (
                <SensitivityPicker current={selectedScout.sensitivity} />
              ) : (
                <p className="text-[13px] text-white/50">{selectedScout.sensitivity}</p>
              )}
            </EditableCard>

            {/* Cadence */}
            <EditableCard
              label="CADENCE"
              isEditing={editingField === "cadence"}
              onEdit={() => setEditingField("cadence")}
              onCancel={() => setEditingField(null)}
              onSave={() => setEditingField(null)}
              editType="inline"
            >
              {editingField === "cadence" ? (
                <CadencePicker
                  baseIntervalHours={selectedScout.cadenceIntervalHours}
                  burstMinHours={selectedScout.cadenceMinIntervalHours}
                />
              ) : (
                <p className="text-[13px] text-white/50 whitespace-pre-line">
                  {selectedScout.cadenceCurrentIntervalHours < selectedScout.cadenceIntervalHours
                    ? `Base: ${humanizeCadence(selectedScout.cadenceIntervalHours)}\nCurrent: ${humanizeCadence(selectedScout.cadenceCurrentIntervalHours)} (${selectedScout.cadenceReason})`
                    : humanizeCadence(selectedScout.cadenceIntervalHours)}
                </p>
              )}
            </EditableCard>

            {/* Budget */}
            <EditableCard
              label="BUDGET"
              isEditing={editingField === "budget"}
              onEdit={() => setEditingField("budget")}
              onCancel={() => setEditingField(null)}
              onSave={() => setEditingField(null)}
              editType="inline"
            >
              {editingField === "budget" ? (
                <BudgetEditor used={selectedScout.budgetUsed} total={selectedScout.budgetTotal} />
              ) : (
                <div className="space-y-2.5">
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-lg font-bold text-white">{selectedScout.budgetUsed}</span>
                    <span className="text-sm text-white/30">/ {selectedScout.budgetTotal} runs</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${budgetPercent}%`,
                        background: budgetPercent > 80
                          ? "linear-gradient(90deg, #F59E0B, #EF4444)"
                          : budgetPercent > 50
                            ? "linear-gradient(90deg, #3B82F6, #60A5FA)"
                            : "linear-gradient(90deg, #22C55E, #4ADE80)",
                      }}
                    />
                  </div>
                  <div className="text-[11px] text-white/30">{budgetPercent}% used this month</div>
                </div>
              )}
            </EditableCard>
          </div>

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

          {activeTab === "findings" ? (
            <div className="space-y-2">
              {scoutFindings.length > 0 ? (
                scoutFindings.map((finding) => (
                  <FindingCard key={finding.id} finding={finding} />
                ))
              ) : (
                <div className="text-center py-12">
                  <p className="text-sm text-white/30">No findings yet.</p>
                  <p className="text-xs text-white/30 mt-1">This scout is still monitoring.</p>
                </div>
              )}
            </div>
          ) : (
            <div className="text-center py-12">
              <p className="text-sm text-white/30">Activity log coming soon.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Editable Card ────────────────────────────────────────────────

function EditableCard({
  label,
  children,
  isEditing,
  onEdit,
  onCancel,
  onSave,
  editType,
}: {
  label: string;
  children: React.ReactNode;
  isEditing: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSave?: () => void;
  editType: "inline" | "brett";
}) {
  return (
    <div className={`group rounded-xl border p-4 space-y-2.5 transition-all duration-200 ${
      isEditing
        ? "bg-white/[0.05] border-blue-500/20 shadow-[0_0_16px_rgba(59,130,246,0.05)]"
        : "bg-white/[0.03] border-white/[0.06]"
    }`}>
      <div className="flex items-center justify-between">
        <div className="text-[10px] font-semibold tracking-widest text-white/30 uppercase">{label}</div>
        {isEditing ? (
          <div className="flex items-center gap-1">
            {onSave && (
              <button
                onClick={onSave}
                className="flex items-center gap-1 px-2 py-1 rounded-md bg-blue-600/80 hover:bg-blue-500 text-white text-[10px] font-semibold transition-colors"
              >
                <Check size={10} />
                Save
              </button>
            )}
            <button
              onClick={onCancel}
              className="flex items-center px-1.5 py-1 rounded-md hover:bg-white/[0.06] text-white/30 hover:text-white/50 transition-colors"
            >
              <X size={12} />
            </button>
          </div>
        ) : (
          <button
            onClick={onEdit}
            className="flex items-center gap-1 px-2 py-1 rounded-md opacity-0 group-hover:opacity-100 hover:bg-white/[0.06] text-white/30 hover:text-white/50 text-[10px] font-medium transition-all"
          >
            {editType === "brett" ? (
              <>
                <MessageSquare size={10} />
                Edit with Brett
              </>
            ) : (
              <Pencil size={10} />
            )}
          </button>
        )}
      </div>

      {isEditing && editType === "brett" ? (
        <div className="space-y-3">
          {children}
          <div className="rounded-lg bg-white/[0.04] border border-white/[0.06] p-3 space-y-2">
            <p className="text-[11px] text-white/30">What would you like to change?</p>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="e.g., Also watch for supply chain issues..."
                className="flex-1 bg-white/[0.04] border border-white/[0.06] rounded-lg px-3 py-2 text-[12px] text-white placeholder-white/20 focus:outline-none focus:border-blue-500/30 focus:ring-1 focus:ring-blue-500/20"
              />
              <button className="px-3 py-2 rounded-lg bg-blue-600/80 hover:bg-blue-500 text-white text-[11px] font-semibold transition-colors flex-shrink-0">
                Send
              </button>
            </div>
          </div>
        </div>
      ) : (
        children
      )}
    </div>
  );
}

// ── Sensitivity Picker ───────────────────────────────────────────

const SENSITIVITY_OPTIONS = [
  { value: "low", label: "Low", desc: "Surface anything from credible sources" },
  { value: "medium", label: "Medium", desc: "Notable developments and signals only" },
  { value: "high", label: "High", desc: "Only major, material developments" },
] as const;

function SensitivityPicker({ current }: { current: string }) {
  const currentValue = current.toLowerCase().startsWith("low") ? "low"
    : current.toLowerCase().startsWith("high") ? "high" : "medium";
  const [selected, setSelected] = useState(currentValue);

  return (
    <div className="space-y-1.5">
      {SENSITIVITY_OPTIONS.map((opt) => (
        <button
          key={opt.value}
          onClick={() => setSelected(opt.value)}
          className={`flex items-center gap-3 w-full p-2.5 rounded-lg text-left transition-all duration-150 ${
            selected === opt.value
              ? "bg-blue-500/10 border border-blue-500/20"
              : "bg-white/[0.02] border border-transparent hover:bg-white/[0.04]"
          }`}
        >
          <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
            selected === opt.value ? "border-blue-400" : "border-white/20"
          }`}>
            {selected === opt.value && <div className="w-2 h-2 rounded-full bg-blue-400" />}
          </div>
          <div>
            <div className={`text-[12px] font-semibold ${selected === opt.value ? "text-white" : "text-white/50"}`}>
              {opt.label}
            </div>
            <div className="text-[11px] text-white/30">{opt.desc}</div>
          </div>
        </button>
      ))}
    </div>
  );
}

// ── Cadence Picker ───────────────────────────────────────────────

const CADENCE_PRESETS = [
  { label: "Every hour", hours: 1 },
  { label: "Every 4h", hours: 4 },
  { label: "Every 8h", hours: 8 },
  { label: "Every 12h", hours: 12 },
  { label: "Daily", hours: 24 },
  { label: "Every 2d", hours: 48 },
  { label: "Every 3d", hours: 72 },
  { label: "Weekly", hours: 168 },
] as const;

function CadencePicker({ baseIntervalHours, burstMinHours }: { baseIntervalHours: number; burstMinHours: number }) {
  const [selectedBase, setSelectedBase] = useState<number>(baseIntervalHours);
  const [burstHours, setBurstHours] = useState<number>(burstMinHours);

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="text-[11px] text-white/30 font-medium">Base check frequency</div>
        <div className="grid grid-cols-4 gap-1.5">
          {CADENCE_PRESETS.map((preset) => (
            <button
              key={preset.hours}
              onClick={() => setSelectedBase(preset.hours)}
              className={`px-2 py-1.5 rounded-lg text-[11px] font-medium transition-all ${
                selectedBase === preset.hours
                  ? "bg-blue-500/15 text-blue-300 border border-blue-500/25"
                  : "bg-white/[0.03] text-white/30 border border-transparent hover:bg-white/[0.06]"
              }`}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <div className="text-[11px] text-white/30 font-medium">
          Burst minimum <span className="text-white/15">— scout can speed up to this</span>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setBurstHours(Math.max(1, burstHours - (burstHours > 12 ? 12 : burstHours > 4 ? 4 : 1)))}
            className="w-7 h-7 rounded-lg bg-white/[0.05] border border-white/[0.08] flex items-center justify-center text-white/50 hover:text-white hover:bg-white/[0.08] transition-colors"
          >
            <Minus size={12} />
          </button>
          <span className="text-[13px] font-semibold text-white min-w-[80px] text-center">
            {CADENCE_PRESETS.find((p) => p.hours === burstHours)?.label ?? `Every ${burstHours}h`}
          </span>
          <button
            onClick={() => setBurstHours(Math.min(selectedBase, burstHours + (burstHours >= 12 ? 12 : burstHours >= 4 ? 4 : 1)))}
            className="w-7 h-7 rounded-lg bg-white/[0.05] border border-white/[0.08] flex items-center justify-center text-white/50 hover:text-white hover:bg-white/[0.08] transition-colors"
          >
            <Plus size={12} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Budget Editor ────────────────────────────────────────────────

function BudgetEditor({ used, total }: { used: number; total: number }) {
  const [budget, setBudget] = useState(total);
  const presets = [30, 45, 60, 90, 120];

  return (
    <div className="space-y-3">
      <div className="flex items-baseline gap-1.5">
        <span className="text-lg font-bold text-white">{used}</span>
        <span className="text-sm text-white/30">used of</span>
      </div>

      <div className="space-y-2">
        <div className="text-[11px] text-white/30 font-medium">Monthly run limit</div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setBudget(Math.max(used, budget - 10))}
            className="w-7 h-7 rounded-lg bg-white/[0.05] border border-white/[0.08] flex items-center justify-center text-white/50 hover:text-white hover:bg-white/[0.08] transition-colors"
          >
            <Minus size={12} />
          </button>
          <span className="text-xl font-bold text-white min-w-[50px] text-center">{budget}</span>
          <button
            onClick={() => setBudget(budget + 10)}
            className="w-7 h-7 rounded-lg bg-white/[0.05] border border-white/[0.08] flex items-center justify-center text-white/50 hover:text-white hover:bg-white/[0.08] transition-colors"
          >
            <Plus size={12} />
          </button>
          <span className="text-[11px] text-white/30">runs / month</span>
        </div>
      </div>

      <div className="flex gap-1.5">
        {presets.map((p) => (
          <button
            key={p}
            onClick={() => setBudget(p)}
            className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all ${
              budget === p
                ? "bg-blue-500/15 text-blue-300 border border-blue-500/25"
                : "bg-white/[0.03] text-white/30 border border-transparent hover:bg-white/[0.06]"
            }`}
          >
            {p}
          </button>
        ))}
      </div>

      <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
        <div
          className="h-full rounded-full bg-gradient-to-r from-blue-500 to-blue-400 transition-all duration-300"
          style={{ width: `${Math.round((used / budget) * 100)}%` }}
        />
      </div>
    </div>
  );
}

// ── Shared ───────────────────────────────────────────────────────

function StatusBadge({ status }: { status: Scout["status"] }) {
  if (status === "active") {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-500/15 text-[11px] font-semibold text-emerald-400 border border-emerald-500/15">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
        Active
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full bg-white/[0.06] text-[11px] font-semibold text-white/30 border border-white/[0.04]">
      {status === "completed" ? "Completed" : status === "paused" ? "Paused" : "Expired"}
    </span>
  );
}

function TabButton({ label, count, isActive, onClick }: { label: string; count?: number; isActive: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-4 py-2 rounded-md text-[13px] font-medium transition-all duration-200 ${
        isActive ? "bg-white/[0.08] text-white shadow-sm" : "text-white/30 hover:text-white/50"
      }`}
    >
      {label}
      {count !== undefined && <span className={`text-xs ${isActive ? "text-white/50" : "text-white/30"}`}>{count}</span>}
    </button>
  );
}

function FindingCard({ finding }: { finding: ScoutFinding }) {
  const config = {
    insight: { icon: <Zap size={14} />, bg: "bg-purple-500/15", color: "text-purple-400", border: "border-purple-500/10" },
    article: { icon: <FileText size={14} />, bg: "bg-blue-500/15", color: "text-blue-400", border: "border-blue-500/10" },
    task: { icon: <CircleCheck size={14} />, bg: "bg-amber-500/15", color: "text-amber-400", border: "border-amber-500/10" },
  }[finding.type];

  const typeLabel = { insight: "Insight", article: "Article", task: "Task" }[finding.type];

  return (
    <div className={`flex gap-3.5 p-4 rounded-xl bg-white/[0.03] border ${config.border} hover:bg-white/[0.05] transition-colors cursor-pointer`}>
      <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${config.bg}`}>
        <span className={config.color}>{config.icon}</span>
      </div>
      <div className="flex-1 min-w-0 space-y-1">
        <h4 className="text-[13px] font-semibold text-white">{finding.title}</h4>
        <p className="text-xs text-white/50 leading-relaxed">{finding.description}</p>
        <span className="text-[11px] text-white/30">{typeLabel} · {finding.createdAt}</span>
      </div>
    </div>
  );
}
