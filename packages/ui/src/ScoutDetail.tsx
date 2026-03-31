import React, { useState } from "react";
import {
  Pencil,
  Pause,
  Play,
  Zap,
  FileText,
  CircleCheck,
  ArrowLeft,
  ExternalLink,
  Check,
  X,
  MessageSquare,
  Minus,
  Plus,
  Activity,
  CheckCircle2,
  XCircle,
  SkipForward,
  Loader2,
  Trash2,
  ThumbsUp,
  ThumbsDown,
} from "lucide-react";
import type {
  Scout,
  ScoutFinding,
  ScoutMemory,
  ActivityEntry,
  ScoutSensitivity,
  ScoutAnalysisTier,
  UpdateScoutInput,
} from "@brett/types";
import { formatRelativeTime, humanizeCadence } from "@brett/utils";
import { ScoutCard } from "./ScoutCard";
import { ScoutMemoryTab } from "./ScoutMemoryTab";

interface ScoutDetailProps {
  scouts: Scout[];
  scout: Scout;
  findings: ScoutFinding[];
  activity: ActivityEntry[];
  isLoadingFindings?: boolean;
  isLoadingActivity?: boolean;
  onSelectScout: (scout: Scout) => void;
  onBack: () => void;
  onPause: () => void;
  onResume: () => void;
  onUpdate: (data: UpdateScoutInput) => void;
  onEditWithBrett?: (field: string) => void;
  onTriggerRun?: () => void;
  isRunning?: boolean;
  onClearHistory?: () => void;
  isClearing?: boolean;
  onConsolidate?: () => void;
  isConsolidating?: boolean;
  onDelete?: () => void;
  onClickFindingItem?: (itemId: string) => void;
  memories: ScoutMemory[];
  isLoadingMemories: boolean;
  onDeleteMemory: (memoryId: string) => void;
}

export function ScoutDetail({
  scouts,
  scout,
  findings,
  activity,
  isLoadingFindings,
  isLoadingActivity,
  onSelectScout,
  onBack,
  onPause,
  onResume,
  onUpdate,
  onEditWithBrett,
  onTriggerRun,
  isRunning,
  onClearHistory,
  isClearing,
  onConsolidate,
  isConsolidating,
  onDelete,
  onClickFindingItem,
  memories,
  isLoadingMemories,
  onDeleteMemory,
}: ScoutDetailProps) {
  const [activeTab, setActiveTab] = useState<"findings" | "log" | "memory">("findings");
  const [editingField, setEditingField] = useState<string | null>(null);
  const [pendingSensitivity, setPendingSensitivity] = useState<ScoutSensitivity | null>(null);
  const [pendingAnalysisTier, setPendingAnalysisTier] = useState<ScoutAnalysisTier | null>(null);
  const [pendingCadenceBase, setPendingCadenceBase] = useState<number | null>(null);
  const [pendingBudget, setPendingBudget] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const isCompleted = scout.status === "completed" || scout.status === "expired";
  const isPaused = scout.status === "paused";
  const budgetPercent = Math.round((scout.budgetUsed / scout.budgetTotal) * 100);

  const handleSaveSensitivity = () => {
    if (pendingSensitivity !== null) {
      onUpdate({ sensitivity: pendingSensitivity });
    }
    setPendingSensitivity(null);
    setEditingField(null);
  };

  const handleSaveAnalysisTier = () => {
    if (pendingAnalysisTier !== null) {
      onUpdate({ analysisTier: pendingAnalysisTier });
    }
    setPendingAnalysisTier(null);
    setEditingField(null);
  };

  const handleSaveCadence = () => {
    if (pendingCadenceBase !== null) {
      // User sets the cadence — update both base and current together
      onUpdate({
        cadenceIntervalHours: pendingCadenceBase,
        cadenceCurrentIntervalHours: pendingCadenceBase,
        cadenceReason: null as any,
      });
    }
    setPendingCadenceBase(null);
    setEditingField(null);
  };

  const handleSaveBudget = () => {
    if (pendingBudget !== null) {
      onUpdate({ budgetTotal: pendingBudget });
    }
    setPendingBudget(null);
    setEditingField(null);
  };

  const handleCancelEdit = (field: string) => {
    if (field === "sensitivity") setPendingSensitivity(null);
    if (field === "analysisTier") setPendingAnalysisTier(null);
    if (field === "cadence") { setPendingCadenceBase(null); }
    if (field === "budget") setPendingBudget(null);
    setEditingField(null);
  };

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
          {scouts.map((s) => (
            <ScoutCard
              key={s.id}
              scout={s}
              onClick={() => onSelectScout(s)}
              isSelected={s.id === scout.id}
              variant="compact"
            />
          ))}
        </div>
      </div>

      {/* Detail Panel */}
      <div className="flex-1 min-w-0 overflow-y-auto scrollbar-hide bg-black/20 backdrop-blur-lg rounded-2xl border border-white/[0.06]">
        {/* Header */}
        <div className="relative overflow-hidden">
          {!isCompleted && (
            <div
              className="absolute top-0 left-0 w-full h-40 opacity-[0.04] pointer-events-none"
              style={{
                background: `radial-gradient(ellipse at 15% 0%, ${scout.avatarGradient[0]}, transparent 60%)`,
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
                      : `linear-gradient(135deg, ${scout.avatarGradient[0]}, ${scout.avatarGradient[1]})`,
                  }}
                >
                  <span className={`text-2xl font-bold ${isCompleted ? "text-white/30" : "text-white"}`}>
                    {scout.avatarLetter}
                  </span>
                </div>
                {!isCompleted && (
                  <div
                    className="absolute inset-0 rounded-2xl blur-xl opacity-30"
                    style={{ background: scout.avatarGradient[0] }}
                  />
                )}
              </div>

              <div className="flex-1 min-w-0 space-y-1">
                <div className="flex items-center gap-3">
                  <h2 className="text-xl font-bold text-white">{scout.name}</h2>
                  <StatusBadge status={scout.status} />
                </div>
                {scout.statusLine && (
                  <p className="text-[13px] font-medium text-blue-400/70">
                    {scout.statusLine}
                  </p>
                )}
                {scout.endDate && (
                  <p className="text-[12px] text-white/30">Ended {scout.endDate}</p>
                )}
                {!isCompleted && scout.nextRunAt && (
                  <p className="text-[12px] text-white/30">
                    Next run {formatRelativeTime(scout.nextRunAt)}
                  </p>
                )}
              </div>

              <div className="flex items-center gap-2 flex-shrink-0 ml-auto">
                {onTriggerRun && (
                  <button
                    onClick={onTriggerRun}
                    disabled={isRunning}
                    className="px-3 py-1.5 text-xs font-medium rounded-md bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
                  >
                    {isRunning ? <Loader2 size={12} className="animate-spin" /> : <span>▶</span>}
                    <span>{isRunning ? "Running..." : "Run Now"}</span>
                  </button>
                )}
                {onConsolidate && (
                  <button
                    onClick={onConsolidate}
                    disabled={isConsolidating}
                    className="px-3 py-1.5 text-xs font-medium rounded-md bg-purple-500/20 text-purple-400 hover:bg-purple-500/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
                  >
                    {isConsolidating ? <Loader2 size={12} className="animate-spin" /> : <span>🧠</span>}
                    <span>{isConsolidating ? "Consolidating..." : "Consolidate"}</span>
                  </button>
                )}
                {onClearHistory && (
                  <button
                    onClick={onClearHistory}
                    disabled={isClearing}
                    className="px-3 py-1.5 text-xs font-medium rounded-md bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
                  >
                    {isClearing ? <Loader2 size={12} className="animate-spin" /> : <span>✕</span>}
                    <span>{isClearing ? "Clearing..." : "Clear History"}</span>
                  </button>
                )}
                {!isCompleted && (
                  isPaused ? (
                    <button
                      onClick={onResume}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 transition-colors text-xs font-medium"
                    >
                      <Play size={12} />
                      Resume
                    </button>
                  ) : (
                    <button
                      onClick={onPause}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-white/[0.05] text-white/50 hover:bg-white/[0.10] hover:text-white transition-colors text-xs font-medium"
                    >
                      <Pause size={12} />
                      Pause
                    </button>
                  )
                )}
                {onDelete && (
                  confirmDelete ? (
                    <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-red-500/10 border border-red-500/20">
                      <span className="text-xs text-red-400">Delete?</span>
                      <button
                        onClick={() => { onDelete(); setConfirmDelete(false); }}
                        className="px-2 py-0.5 text-xs font-medium rounded bg-red-500/30 text-red-300 hover:bg-red-500/40 transition-colors"
                      >
                        Yes
                      </button>
                      <button
                        onClick={() => setConfirmDelete(false)}
                        className="px-2 py-0.5 text-xs font-medium rounded bg-white/[0.05] text-white/50 hover:bg-white/[0.10] transition-colors"
                      >
                        No
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmDelete(true)}
                      className="px-2.5 py-1.5 text-xs font-medium rounded-md bg-white/[0.05] text-white/30 hover:bg-red-500/20 hover:text-red-400 transition-colors flex items-center"
                    >
                      <Trash2 size={14} />
                    </button>
                  )
                )}
              </div>
            </div>

            {/* Goal */}
            <EditableCard
              label="GOAL"
              isEditing={editingField === "goal"}
              onEdit={() => {
                setEditingField("goal");
                onEditWithBrett?.("goal");
              }}
              onCancel={() => handleCancelEdit("goal")}
              editType="brett"
            >
              <p className="text-[14px] text-white/90 leading-relaxed">{scout.goal}</p>
            </EditableCard>
          </div>
        </div>

        <div className="px-8 pb-8 space-y-5">
          {/* Config Grid */}
          <div className="grid grid-cols-2 gap-4">
            {/* Sources */}
            <EditableCard
              label="SOURCES"
              isEditing={editingField === "sources"}
              onEdit={() => {
                setEditingField("sources");
                onEditWithBrett?.("sources");
              }}
              onCancel={() => handleCancelEdit("sources")}
              editType="brett"
            >
              <div className="flex flex-wrap gap-1.5">
                {scout.sources.map((source) =>
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
              onCancel={() => handleCancelEdit("sensitivity")}
              onSave={handleSaveSensitivity}
              editType="inline"
            >
              {editingField === "sensitivity" ? (
                <SensitivityPicker
                  current={pendingSensitivity ?? scout.sensitivity}
                  onChange={setPendingSensitivity}
                />
              ) : (
                <p className="text-[13px] text-white/50">
                  {SENSITIVITY_OPTIONS.find((o) => o.value === scout.sensitivity)?.label ?? scout.sensitivity}
                  <span className="text-white/25"> — {SENSITIVITY_OPTIONS.find((o) => o.value === scout.sensitivity)?.desc}</span>
                </p>
              )}
            </EditableCard>

            {/* Analysis Tier */}
            <EditableCard
              label="ANALYSIS"
              isEditing={editingField === "analysisTier"}
              onEdit={() => setEditingField("analysisTier")}
              onCancel={() => handleCancelEdit("analysisTier")}
              onSave={handleSaveAnalysisTier}
              editType="inline"
            >
              {editingField === "analysisTier" ? (
                <AnalysisTierPicker
                  current={pendingAnalysisTier ?? scout.analysisTier}
                  onChange={setPendingAnalysisTier}
                />
              ) : (
                <p className="text-[13px] text-white/50">
                  {scout.analysisTier === "deep" ? "Deep" : "Standard"}
                  <span className="text-white/25">
                    {scout.analysisTier === "deep"
                      ? " — thorough analysis, higher cost per run"
                      : " — fast and cost-effective"}
                  </span>
                </p>
              )}
            </EditableCard>

            {/* Cadence */}
            <EditableCard
              label="CADENCE"
              isEditing={editingField === "cadence"}
              onEdit={() => setEditingField("cadence")}
              onCancel={() => handleCancelEdit("cadence")}
              onSave={handleSaveCadence}
              editType="inline"
            >
              {editingField === "cadence" ? (
                <CadencePicker
                  intervalHours={pendingCadenceBase ?? scout.cadenceCurrentIntervalHours}
                  onChange={setPendingCadenceBase}
                />
              ) : (
                <div className="space-y-1">
                  <p className="text-[13px] text-white/50">
                    {humanizeCadence(scout.cadenceCurrentIntervalHours)}
                  </p>
                  {scout.cadenceReason && scout.cadenceCurrentIntervalHours !== scout.cadenceIntervalHours && (
                    <p className="text-[11px] text-blue-400/60">
                      Adjusted by Brett: {scout.cadenceReason}
                    </p>
                  )}
                </div>
              )}
            </EditableCard>

            {/* Budget */}
            <EditableCard
              label="BUDGET"
              isEditing={editingField === "budget"}
              onEdit={() => setEditingField("budget")}
              onCancel={() => handleCancelEdit("budget")}
              onSave={handleSaveBudget}
              editType="inline"
            >
              {editingField === "budget" ? (
                <BudgetEditor
                  used={scout.budgetUsed}
                  total={pendingBudget ?? scout.budgetTotal}
                  onChange={setPendingBudget}
                />
              ) : (
                <div className="space-y-2.5">
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-lg font-bold text-white">{scout.budgetUsed}</span>
                    <span className="text-sm text-white/30">/ {scout.budgetTotal} runs</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${budgetPercent}%`,
                        background:
                          budgetPercent > 80
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
              count={findings.length}
              isActive={activeTab === "findings"}
              onClick={() => setActiveTab("findings")}
            />
            <TabButton
              label="Activity Log"
              isActive={activeTab === "log"}
              onClick={() => setActiveTab("log")}
            />
            <TabButton
              label="Memory"
              count={memories.length}
              isActive={activeTab === "memory"}
              onClick={() => setActiveTab("memory")}
            />
          </div>

          {activeTab === "findings" ? (
            <div className="space-y-2">
              {isLoadingFindings ? (
                <div className="space-y-2">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="h-20 rounded-xl bg-white/[0.03] border border-white/[0.06] animate-pulse" />
                  ))}
                </div>
              ) : findings.length > 0 ? (
                findings.map((finding) => (
                    <FindingCard
                      key={finding.id}
                      finding={finding}
                      onClickItem={onClickFindingItem}
                    />
                  ))
              ) : (
                <div className="text-center py-12">
                  <p className="text-sm text-white/30">No findings yet.</p>
                  <p className="text-xs text-white/30 mt-1">This scout is still monitoring.</p>
                </div>
              )}
            </div>
          ) : activeTab === "log" ? (
            <div className="space-y-2">
              {isLoadingActivity ? (
                <div className="space-y-2">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="h-12 rounded-xl bg-white/[0.03] border border-white/[0.06] animate-pulse" />
                  ))}
                </div>
              ) : activity.length > 0 ? (
                activity.map((entry) => (
                  <ActivityRow key={entry.id} entry={entry} />
                ))
              ) : (
                <div className="text-center py-12">
                  <p className="text-sm text-white/30">No activity yet.</p>
                </div>
              )}
            </div>
          ) : activeTab === "memory" ? (
            <ScoutMemoryTab
              memories={memories}
              isLoading={isLoadingMemories}
              onDelete={onDeleteMemory}
            />
          ) : null}
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
    <div
      className={`group rounded-xl border p-4 space-y-2.5 transition-all duration-200 ${
        isEditing
          ? "bg-white/[0.05] border-blue-500/20 shadow-[0_0_16px_rgba(59,130,246,0.05)]"
          : "bg-white/[0.03] border-white/[0.06]"
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="text-[10px] font-semibold tracking-widest text-white/30 uppercase">
          {label}
        </div>
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

const SENSITIVITY_OPTIONS: Array<{ value: ScoutSensitivity; label: string; desc: string }> = [
  { value: "low", label: "Everything", desc: "Surface all mentions — even minor ones. Expect more findings per run." },
  { value: "medium", label: "Notable", desc: "Only developments worth knowing about. Filters out routine noise." },
  { value: "high", label: "Critical only", desc: "Only material changes that demand your attention. Very selective." },
];

function SensitivityPicker({
  current,
  onChange,
}: {
  current: ScoutSensitivity;
  onChange: (v: ScoutSensitivity) => void;
}) {
  return (
    <div className="space-y-1.5">
      {SENSITIVITY_OPTIONS.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={`flex items-center gap-3 w-full p-2.5 rounded-lg text-left transition-all duration-150 ${
            current === opt.value
              ? "bg-blue-500/10 border border-blue-500/20"
              : "bg-white/[0.02] border border-transparent hover:bg-white/[0.04]"
          }`}
        >
          <div
            className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
              current === opt.value ? "border-blue-400" : "border-white/20"
            }`}
          >
            {current === opt.value && <div className="w-2 h-2 rounded-full bg-blue-400" />}
          </div>
          <div>
            <div
              className={`text-[12px] font-semibold ${current === opt.value ? "text-white" : "text-white/50"}`}
            >
              {opt.label}
            </div>
            <div className="text-[11px] text-white/30">{opt.desc}</div>
          </div>
        </button>
      ))}
    </div>
  );
}

// ── Analysis Tier Picker ─────────────────────────────────────────

const ANALYSIS_TIER_OPTIONS: Array<{ value: ScoutAnalysisTier; label: string; desc: string; cost: string }> = [
  { value: "standard", label: "Standard", desc: "Fast, cost-effective. Good for news and event monitoring.", cost: "~$0.001/run" },
  { value: "deep", label: "Deep", desc: "Thorough analysis. Better at nuanced relevance and complex goals.", cost: "~$0.013/run" },
];

function AnalysisTierPicker({
  current,
  onChange,
}: {
  current: ScoutAnalysisTier;
  onChange: (v: ScoutAnalysisTier) => void;
}) {
  return (
    <div className="space-y-1.5">
      {ANALYSIS_TIER_OPTIONS.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={`flex items-center gap-3 w-full p-2.5 rounded-lg text-left transition-all duration-150 ${
            current === opt.value
              ? "bg-blue-500/10 border border-blue-500/20"
              : "bg-white/[0.02] border border-transparent hover:bg-white/[0.04]"
          }`}
        >
          <div
            className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
              current === opt.value ? "border-blue-400" : "border-white/20"
            }`}
          >
            {current === opt.value && <div className="w-2 h-2 rounded-full bg-blue-400" />}
          </div>
          <div className="flex-1">
            <div className={`text-[12px] font-semibold ${current === opt.value ? "text-white" : "text-white/50"}`}>
              {opt.label}
            </div>
            <div className="text-[11px] text-white/30">{opt.desc}</div>
          </div>
          <span className="text-[10px] text-white/20 flex-shrink-0">{opt.cost}</span>
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

function CadencePicker({
  intervalHours,
  onChange,
}: {
  intervalHours: number;
  onChange: (h: number) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="text-[11px] text-white/30 font-medium">Check frequency</div>
      <div className="grid grid-cols-4 gap-1.5">
        {CADENCE_PRESETS.map((preset) => (
          <button
            key={preset.hours}
            onClick={() => onChange(preset.hours)}
            className={`px-2 py-1.5 rounded-lg text-[11px] font-medium transition-all ${
              intervalHours === preset.hours
                ? "bg-blue-500/15 text-blue-300 border border-blue-500/25"
                : "bg-white/[0.03] text-white/30 border border-transparent hover:bg-white/[0.06]"
            }`}
          >
            {preset.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Budget Editor ────────────────────────────────────────────────

function BudgetEditor({
  used,
  total,
  onChange,
}: {
  used: number;
  total: number;
  onChange: (v: number) => void;
}) {
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
            onClick={() => onChange(Math.max(used, total - 10))}
            className="w-7 h-7 rounded-lg bg-white/[0.05] border border-white/[0.08] flex items-center justify-center text-white/50 hover:text-white hover:bg-white/[0.08] transition-colors"
          >
            <Minus size={12} />
          </button>
          <span className="text-xl font-bold text-white min-w-[50px] text-center">{total}</span>
          <button
            onClick={() => onChange(total + 10)}
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
            onClick={() => onChange(p)}
            className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all ${
              total === p
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
          style={{ width: `${Math.round((used / total) * 100)}%` }}
        />
      </div>
    </div>
  );
}

// ── Activity Row ─────────────────────────────────────────────────

function ActivityRow({ entry }: { entry: ActivityEntry }) {
  if (entry.entryType === "run") {
    const statusIcon =
      entry.status === "success" ? (
        <CheckCircle2 size={14} className="text-emerald-400" />
      ) : entry.status === "failed" ? (
        <XCircle size={14} className="text-red-400" />
      ) : entry.status === "running" ? (
        <Loader2 size={14} className="text-blue-400 animate-spin" />
      ) : (
        <SkipForward size={14} className="text-white/30" />
      );

    const stats = [
      entry.resultCount > 0 && `${entry.resultCount} searched`,
      entry.findingsCount > 0 && `${entry.findingsCount} found`,
      entry.dismissedCount > 0 && `${entry.dismissedCount} dismissed`,
    ].filter(Boolean);

    const tokenStr = entry.tokensUsed > 0
      ? entry.tokensUsed >= 1000
        ? `${(entry.tokensUsed / 1000).toFixed(1)}k tokens`
        : `${entry.tokensUsed} tokens`
      : null;

    const durationStr = entry.durationMs > 0
      ? entry.durationMs >= 1000
        ? `${(entry.durationMs / 1000).toFixed(1)}s`
        : `${entry.durationMs}ms`
      : null;

    return (
      <div className="flex items-start gap-3 p-3 rounded-xl bg-white/[0.02] border border-white/[0.04]">
        <div className="mt-0.5 flex-shrink-0">{statusIcon}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[12px] font-medium text-white/70 capitalize">
              Run {entry.status}
            </span>
            {stats.length > 0 && (
              <span className="text-[11px] text-white/30">
                {stats.join(" · ")}
              </span>
            )}
          </div>
          {entry.reasoning && (
            <p className="text-[11px] text-white/30 mt-0.5 line-clamp-2">{entry.reasoning}</p>
          )}
          {entry.error && (
            <p className="text-[11px] text-red-400/70 mt-0.5">{entry.error}</p>
          )}
          {(tokenStr || durationStr) && (
            <p className="text-[10px] text-white/20 mt-1">
              {[durationStr, tokenStr].filter(Boolean).join(" · ")}
            </p>
          )}
        </div>
        <span className="text-[10px] text-white/20 flex-shrink-0">
          {formatRelativeTime(entry.createdAt)}
        </span>
      </div>
    );
  }

  // activity entry
  const meta = entry.metadata as { before?: Record<string, unknown>; after?: Record<string, unknown> } | null;
  const isConfigChange = entry.type === "config_changed" && meta?.before && meta?.after;

  return (
    <div className="flex items-start gap-3 p-3 rounded-xl bg-white/[0.02] border border-white/[0.04]">
      <div className="mt-0.5 flex-shrink-0">
        <Activity size={14} className="text-white/30" />
      </div>
      <div className="flex-1 min-w-0">
        <span className="text-[12px] text-white/60">{entry.description}</span>
        {isConfigChange && (
          <div className="mt-1 space-y-0.5">
            {Object.keys(meta.after!).map((key) => {
              const before = meta.before![key];
              const after = meta.after![key];
              const label = formatFieldName(key);
              const beforeStr = formatFieldValue(key, before);
              const afterStr = formatFieldValue(key, after);
              return (
                <p key={key} className="text-[11px] text-white/30">
                  {label}: <span className="text-white/20 line-through">{beforeStr}</span> → <span className="text-white/50">{afterStr}</span>
                </p>
              );
            })}
          </div>
        )}
      </div>
      <span className="text-[10px] text-white/20 flex-shrink-0">
        {formatRelativeTime(entry.createdAt)}
      </span>
    </div>
  );
}

function formatFieldName(key: string): string {
  const names: Record<string, string> = {
    sensitivity: "Sensitivity",
    cadenceIntervalHours: "Cadence",
    cadenceCurrentIntervalHours: "Current cadence",
    cadenceMinIntervalHours: "Min cadence",
    cadenceReason: "Cadence reason",
    budgetTotal: "Budget",
    goal: "Goal",
    name: "Name",
    context: "Context",
    statusLine: "Status line",
    endDate: "End date",
  };
  return names[key] ?? key;
}

function formatFieldValue(key: string, value: unknown): string {
  if (value === null || value === undefined) return "none";
  if (key.includes("cadence") && key.includes("Hours") && typeof value === "number") {
    return humanizeCadence(value);
  }
  if (key === "budgetTotal") return `${value} runs/mo`;
  if (typeof value === "string" && value.length > 60) return value.slice(0, 60) + "...";
  return String(value);
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
  if (status === "paused") {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-amber-500/15 text-[11px] font-semibold text-amber-400 border border-amber-500/15">
        <Pause size={10} />
        Paused
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full bg-white/[0.06] text-[11px] font-semibold text-white/30 border border-white/[0.04]">
      {status === "completed" ? "Completed" : "Expired"}
    </span>
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
      className={`flex items-center gap-1.5 px-4 py-2 rounded-md text-[13px] font-medium transition-all duration-200 ${
        isActive ? "bg-white/[0.08] text-white shadow-sm" : "text-white/30 hover:text-white/50"
      }`}
    >
      {label}
      {count !== undefined && (
        <span className={`text-xs ${isActive ? "text-white/50" : "text-white/30"}`}>{count}</span>
      )}
    </button>
  );
}

function FindingCard({
  finding,
  onClickItem,
}: {
  finding: ScoutFinding;
  onClickItem?: (itemId: string) => void;
}) {
  const config = {
    insight: {
      icon: <Zap size={14} />,
      bg: "bg-purple-500/15",
      color: "text-purple-400",
      border: "border-purple-500/10",
    },
    article: {
      icon: <FileText size={14} />,
      bg: "bg-blue-500/15",
      color: "text-blue-400",
      border: "border-blue-500/10",
    },
    task: {
      icon: <CircleCheck size={14} />,
      bg: "bg-amber-500/15",
      color: "text-amber-400",
      border: "border-amber-500/10",
    },
  }[finding.type];

  const typeLabel = { insight: "Insight", article: "Article", task: "Task" }[finding.type];

  const isClickable = !!(finding.itemId && onClickItem);

  return (
    <div
      onClick={isClickable ? () => onClickItem!(finding.itemId!) : undefined}
      className={`flex gap-3.5 p-4 rounded-xl bg-white/[0.03] border ${config.border} hover:bg-white/[0.05] transition-colors ${isClickable ? "cursor-pointer" : ""}`}
    >
      <div
        className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${config.bg}`}
      >
        <span className={config.color}>{config.icon}</span>
      </div>
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center gap-2">
          <h4 className={`text-[13px] font-semibold ${finding.itemCompleted ? "text-white/30 line-through" : "text-white"}`}>{finding.title}</h4>
          {finding.itemCompleted && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-[9px] font-semibold text-emerald-400/70">
              <Check size={8} />
              Done
            </span>
          )}
        </div>
        <p className={`text-xs leading-relaxed ${finding.itemCompleted ? "text-white/30" : "text-white/50"}`}>{finding.description}</p>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-white/30">
            {typeLabel} · {formatRelativeTime(finding.createdAt)}
          </span>
          {finding.sourceUrl && (
            <a
              href={finding.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="text-[11px] text-blue-400/60 hover:text-blue-400 transition-colors inline-flex items-center gap-0.5"
            >
              {finding.sourceName}
              <ExternalLink size={9} className="opacity-60" />
            </a>
          )}
          {finding.feedbackUseful === true && (
            <span className="inline-flex items-center gap-0.5 text-[11px] text-emerald-400/60">
              <ThumbsUp size={9} />
              Helpful
            </span>
          )}
          {finding.feedbackUseful === false && (
            <span className="inline-flex items-center gap-0.5 text-[11px] text-red-400/60">
              <ThumbsDown size={9} />
              Not helpful
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
