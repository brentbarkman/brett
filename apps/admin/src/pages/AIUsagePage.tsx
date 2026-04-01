import React, { useState } from "react";
import { useAIUsage, useAIUsageDaily, useAISessions } from "../api/ai-usage";
import { StatCard } from "../components/StatCard";
import { DataTable } from "../components/DataTable";

const TIME_RANGES = [
  { label: "Today", days: 1 },
  { label: "7d", days: 7 },
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
] as const;

export function AIUsagePage() {
  const [days, setDays] = useState(30);
  const { data: usage, isLoading: usageLoading } = useAIUsage(days);
  const { data: daily, isLoading: dailyLoading } = useAIUsageDaily(days);
  const { data: sessions, isLoading: sessionsLoading } = useAISessions();

  const rangeLabel = TIME_RANGES.find((r) => r.days === days)?.label ?? `${days}d`;

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold text-white">AI Usage</h1>

      {/* Filtered section — stats, by model, by feature */}
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 space-y-5">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[10px] uppercase tracking-widest text-white/35">
            Filtered view
          </span>
          <div className="flex rounded-lg border border-white/[0.08] overflow-hidden">
            {TIME_RANGES.map((range) => (
              <button
                key={range.days}
                onClick={() => setDays(range.days)}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                  days === range.days
                    ? "bg-blue-500/15 text-blue-400"
                    : "text-white/40 hover:text-white/60 hover:bg-white/5"
                }`}
              >
                {range.label}
              </button>
            ))}
          </div>
        </div>

        {/* Stats cards */}
        {usageLoading ? (
          <div className="grid grid-cols-3 gap-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-20 animate-pulse rounded-xl bg-white/5" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            <StatCard label={`Total Spend (${rangeLabel})`} value={`$${(usage?.totalCostUsd ?? 0).toFixed(2)}`} color="green" />
            <StatCard label={`API Calls (${rangeLabel})`} value={(usage?.totalCalls ?? 0).toLocaleString()} />
            <StatCard label={`Tokens (${rangeLabel})`} value={(usage?.totalTokens ?? 0).toLocaleString()} />
          </div>
        )}

        {/* Spend by model */}
        <div>
          <h2 className="font-mono text-xs uppercase tracking-wider text-white/40 font-semibold mb-3">
            Spend by Model
          </h2>
          <DataTable
            loading={usageLoading}
            data={Object.entries(usage?.byModel ?? {}).map(([model, data]: [string, any]) => ({ model, ...data }))}
            keyField="model"
            emptyMessage="No usage data"
            columns={[
              { key: "model", header: "Model", render: (r: any) => <span className="text-white/90 font-mono text-xs">{r.model}</span> },
              { key: "count", header: "Calls" },
              { key: "inputTokens", header: "Input Tokens", render: (r: any) => r.inputTokens.toLocaleString() },
              { key: "outputTokens", header: "Output Tokens", render: (r: any) => r.outputTokens.toLocaleString() },
              { key: "costUsd", header: "Cost", render: (r: any) => <span className="text-green-400">${r.costUsd.toFixed(2)}</span> },
            ]}
          />
        </div>

        {/* Spend by feature */}
        <div>
          <h2 className="font-mono text-xs uppercase tracking-wider text-white/40 font-semibold mb-3">
            Spend by Feature
          </h2>
          <DataTable
            loading={usageLoading}
            data={Object.entries(usage?.byFeature ?? {})
              .map(([feature, data]: [string, any]) => ({ feature, ...data }))
              .sort((a: any, b: any) => b.costUsd - a.costUsd)}
            keyField="feature"
            emptyMessage="No usage data"
            columns={[
              { key: "feature", header: "Feature", render: (r: any) => <span className="text-white/90">{r.feature}</span> },
              { key: "count", header: "Calls" },
              { key: "inputTokens", header: "Input Tokens", render: (r: any) => r.inputTokens.toLocaleString() },
              { key: "outputTokens", header: "Output Tokens", render: (r: any) => r.outputTokens.toLocaleString() },
              { key: "costUsd", header: "Cost", render: (r: any) => <span className="text-green-400">${r.costUsd.toFixed(2)}</span> },
            ]}
          />
        </div>
      </div>

      {/* Daily trend — always 30d, not filtered */}
      <div>
        <h2 className="font-mono text-xs uppercase tracking-wider text-white/40 font-semibold mb-3">Daily Trend</h2>
        <DataTable
          loading={dailyLoading}
          data={daily?.daily ?? []}
          keyField="date"
          emptyMessage="No daily data"
          columns={[
            { key: "date", header: "Date" },
            { key: "count", header: "Calls" },
            { key: "tokens", header: "Tokens", render: (r: any) => r.tokens.toLocaleString() },
            { key: "costUsd", header: "Cost", render: (r: any) => <span className="text-green-400">${r.costUsd.toFixed(2)}</span> },
          ]}
        />
      </div>

      {/* Recent sessions — not filtered */}
      <div>
        <h2 className="font-mono text-xs uppercase tracking-wider text-white/40 font-semibold mb-3">Recent Sessions</h2>
        <DataTable
          loading={sessionsLoading}
          data={sessions?.sessions ?? []}
          emptyMessage="No sessions"
          columns={[
            {
              key: "source",
              header: "Source",
              render: (r: any) => {
                const isError = r.modelUsed?.startsWith("error:");
                const failed = isError || (r.totalTokens === 0 && r.messageCount === 0 && !r.source?.startsWith("scout:"));
                const scoutFailed = r.scoutStatus === "failed";
                const errorReason = isError ? r.modelUsed.slice(6) : null;
                return (
                  <span className="flex items-center gap-1.5">
                    {r.source}
                    {(failed || scoutFailed) && (
                      <span
                        className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-500/20 text-red-400"
                        title={errorReason || undefined}
                      >
                        failed
                      </span>
                    )}
                  </span>
                );
              },
            },
            { key: "modelUsed", header: "Model", render: (r: any) => {
              const val = r.modelUsed || "";
              if (val.startsWith("error:")) return <span className="font-mono text-xs text-red-400/60">—</span>;
              return <span className="font-mono text-xs">{val || "—"}</span>;
            }},
            { key: "user", header: "User", render: (r: any) => r.user?.email ?? "—" },
            { key: "totalTokens", header: "Tokens", render: (r: any) => r.totalTokens?.toLocaleString() ?? "0" },
            { key: "costUsd", header: "Cost", render: (r: any) => <span className="text-green-400">${r.costUsd?.toFixed(2) ?? "0.00"}</span> },
            { key: "createdAt", header: "When", render: (r: any) => new Date(r.createdAt).toLocaleString() },
          ]}
        />
      </div>
    </div>
  );
}
