import React, { useState } from "react";
import { Bot, Check, ChevronDown, ChevronRight, Loader2, Trash2, X } from "lucide-react";
import {
  useAIConfigs,
  useSaveAIConfig,
  useActivateAIConfig,
  useDeleteAIConfig,
} from "../api/ai-config";
import { useUsageSummary } from "../api/ai-usage";
import { getPreferences, setPreference } from "../api/preferences";
import type { AIProviderName, UserAIConfigRecord } from "@brett/types";

const PROVIDERS: { id: AIProviderName; label: string; hint: string }[] = [
  { id: "anthropic", label: "Anthropic", hint: "sk-ant-..." },
  { id: "openai", label: "OpenAI", hint: "sk-..." },
  { id: "google", label: "Google", hint: "AIza..." },
];

interface ConnectedRowProps {
  config: UserAIConfigRecord & { maskedKey: string };
  onActivate: () => void;
  onDelete: () => void;
  isActivating: boolean;
  isDeleting: boolean;
}

function ConnectedRow({
  config,
  onActivate,
  onDelete,
  isActivating,
  isDeleting,
}: ConnectedRowProps) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const providerLabel =
    PROVIDERS.find((p) => p.id === config.provider)?.label ?? config.provider;

  return (
    <div className="flex items-center justify-between px-3 py-2.5 bg-white/5 rounded-lg">
      <div className="flex items-center gap-2.5 min-w-0">
        <span
          className={`w-2 h-2 rounded-full flex-shrink-0 ${
            config.isValid ? "bg-green-500" : "bg-red-500"
          }`}
        />
        <span className="text-sm text-white truncate">{providerLabel}</span>
        <span className="text-xs text-white/30 font-mono truncate">
          {config.maskedKey}
        </span>
        {config.isActive && (
          <span className="text-xs text-blue-400 font-medium flex-shrink-0">
            Active
          </span>
        )}
      </div>

      <div className="flex items-center gap-2 flex-shrink-0 ml-3">
        {!config.isActive && (
          <button
            onClick={onActivate}
            disabled={isActivating}
            className="text-xs text-white/40 hover:text-blue-400 transition-colors disabled:opacity-40"
          >
            {isActivating ? "Activating..." : "Set active"}
          </button>
        )}
        {confirmDelete ? (
          <>
            <span className="text-xs text-white/40">Remove?</span>
            <button
              onClick={onDelete}
              disabled={isDeleting}
              className="text-xs text-red-400 hover:text-red-300 font-medium transition-colors disabled:opacity-40"
            >
              {isDeleting ? "Removing..." : "Yes"}
            </button>
            <button
              onClick={() => setConfirmDelete(false)}
              className="text-xs text-white/40 hover:text-white/60 transition-colors"
            >
              Cancel
            </button>
          </>
        ) : (
          <button
            onClick={() => setConfirmDelete(true)}
            className="flex items-center gap-1 text-xs text-white/30 hover:text-red-400 transition-colors"
          >
            <Trash2 size={12} />
          </button>
        )}
      </div>
    </div>
  );
}

function UsageStats({ provider }: { provider: string }) {
  const { data, isLoading } = useUsageSummary();

  if (isLoading) {
    return (
      <div className="px-3 py-2">
        <div className="bg-white/5 animate-pulse rounded h-6 w-full" />
      </div>
    );
  }

  if (!data) return null;

  const periods = [
    { label: "Last 24h", rows: data.last24h },
    { label: "Last 7 days", rows: data.last7d },
    { label: "Last 30 days", rows: data.last30d },
  ];

  const filtered = periods.map((p) => ({
    ...p,
    rows: p.rows.filter((r) => r.provider === provider),
  }));

  const hasAny = filtered.some((p) => p.rows.length > 0);

  if (!hasAny) {
    return (
      <div className="px-3 py-2 text-xs text-white/30">
        No usage data yet.
      </div>
    );
  }

  return (
    <div className="px-3 py-2 space-y-2">
      {filtered.map((period) => (
        <div key={period.label}>
          <div className="text-[10px] font-mono uppercase tracking-wider text-white/30 mb-1">
            {period.label}
          </div>
          {period.rows.length === 0 ? (
            <div className="text-[10px] text-white/20 pl-2">--</div>
          ) : (
            period.rows.map((row) => {
              const total = row.inputTokens + row.outputTokens;
              return (
                <div key={row.model} className="flex items-center gap-2 text-[10px] font-mono text-white/50 pl-2">
                  <span className="text-white/40 truncate max-w-[140px]">{row.model}</span>
                  <span className="ml-auto tabular-nums">{row.inputTokens.toLocaleString()} in</span>
                  <span className="tabular-nums">{row.outputTokens.toLocaleString()} out</span>
                  <span className="tabular-nums text-white/60">{total.toLocaleString()} total</span>
                </div>
              );
            })
          )}
        </div>
      ))}
    </div>
  );
}

export function AISection() {
  const { data, isLoading, error } = useAIConfigs();
  const saveConfig = useSaveAIConfig();
  const activateConfig = useActivateAIConfig();
  const deleteConfig = useDeleteAIConfig();

  const configs = data?.configs ?? [];

  const [selectedProvider, setSelectedProvider] =
    useState<AIProviderName>("anthropic");
  const [apiKey, setApiKey] = useState("");
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [showTokenUsage, setShowTokenUsage] = useState(() => getPreferences().showTokenUsage);
  const [expandedUsage, setExpandedUsage] = useState<string | null>(null);

  function handleSave() {
    if (!apiKey.trim()) return;
    setSaveSuccess(false);
    saveConfig.mutate(
      { provider: selectedProvider, apiKey: apiKey.trim() },
      {
        onSuccess: () => {
          setApiKey("");
          setSaveSuccess(true);
          setTimeout(() => setSaveSuccess(false), 3000);
        },
      }
    );
  }

  const selectedHint =
    PROVIDERS.find((p) => p.id === selectedProvider)?.hint ?? "";

  return (
    <div id="ai-settings" className="bg-black/30 backdrop-blur-xl rounded-xl border border-white/10 p-6">
      {/* Header */}
      <div className="mb-4">
        <h3 className="text-xs uppercase tracking-wider text-white/40 font-semibold">
          AI Providers
        </h3>
      </div>

      {/* Show token usage toggle */}
      <div className="flex items-center justify-between px-3 py-2.5 bg-white/5 rounded-lg mb-4">
        <span className="text-sm text-white/70">Show token usage in conversations</span>
        <button
          onClick={() => {
            const next = !showTokenUsage;
            setShowTokenUsage(next);
            setPreference("showTokenUsage", next);
          }}
          className={`relative w-9 h-5 rounded-full transition-colors ${
            showTokenUsage ? "bg-blue-500" : "bg-white/20"
          }`}
        >
          <span
            className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
              showTokenUsage ? "translate-x-4" : "translate-x-0"
            }`}
          />
        </button>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="space-y-2">
          <div className="bg-white/5 animate-pulse rounded-lg h-10 w-full" />
          <div className="bg-white/5 animate-pulse rounded-lg h-8 w-2/3" />
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="text-sm text-red-400 mb-4">
          Failed to load AI provider settings.
        </div>
      )}

      {/* Connected configs */}
      {!isLoading && configs.length > 0 && (
        <div className="space-y-2 mb-5">
          {configs.map((config) => (
            <div key={config.id} className="space-y-0">
              <ConnectedRow
                config={config}
                onActivate={() => activateConfig.mutate(config.id)}
                onDelete={() => deleteConfig.mutate(config.id)}
                isActivating={
                  activateConfig.isPending &&
                  activateConfig.variables === config.id
                }
                isDeleting={
                  deleteConfig.isPending && deleteConfig.variables === config.id
                }
              />
              <button
                onClick={() => setExpandedUsage(expandedUsage === config.id ? null : config.id)}
                className="flex items-center gap-1 px-3 py-1 text-[10px] text-white/30 hover:text-white/50 transition-colors"
              >
                {expandedUsage === config.id ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                Usage
              </button>
              {expandedUsage === config.id && (
                <div className="bg-white/[0.03] rounded-lg border border-white/5 mb-1">
                  <UsageStats provider={config.provider} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && !error && configs.length === 0 && (
        <div className="flex flex-col items-center gap-2 py-4 text-center mb-5">
          <Bot size={24} className="text-white/20" />
          <p className="text-xs text-white/30">
            Configure an AI provider to enable Brett's AI features
          </p>
        </div>
      )}

      {/* Add new config */}
      <div className="space-y-3">
        {/* Provider pills */}
        <div className="flex gap-1.5">
          {PROVIDERS.map((p) => (
            <button
              key={p.id}
              onClick={() => setSelectedProvider(p.id)}
              className={`flex-1 text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                selectedProvider === p.id
                  ? "bg-blue-500/20 border-blue-500/50 text-blue-300"
                  : "bg-white/5 border-white/10 text-white/40 hover:text-white/70 hover:border-white/20"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* API key input + save */}
        <div className="flex gap-2">
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSave()}
            placeholder={selectedHint}
            className="flex-1 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder-white/20 px-3 py-2 focus:outline-none focus:border-white/25 transition-colors"
          />
          <button
            onClick={handleSave}
            disabled={!apiKey.trim() || saveConfig.isPending}
            className="flex items-center gap-1.5 bg-blue-500 hover:bg-blue-400 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium px-3 py-2 rounded-lg transition-colors"
          >
            {saveConfig.isPending ? (
              <Loader2 size={14} className="animate-spin" />
            ) : saveSuccess ? (
              <Check size={14} />
            ) : null}
            {saveConfig.isPending ? "Saving..." : "Save"}
          </button>
        </div>

        {/* Validation feedback */}
        {saveConfig.isError && (
          <div className="flex items-center gap-1.5 text-xs text-red-400">
            <X size={12} />
            {saveConfig.error instanceof Error
              ? saveConfig.error.message
              : "Failed to save API key"}
          </div>
        )}
        {saveSuccess && (
          <div className="flex items-center gap-1.5 text-xs text-green-400">
            <Check size={12} />
            API key saved successfully
          </div>
        )}
      </div>
    </div>
  );
}
