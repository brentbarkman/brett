import React from "react";
import { useDashboardStats } from "../api/dashboard";
import { useAdminScoutRuns } from "../api/scouts";
import { StatCard } from "../components/StatCard";
import { DataTable } from "../components/DataTable";
import { PasskeyBanner } from "../components/PasskeyBanner";

export function DashboardPage() {
  const { data: stats, isLoading: statsLoading } = useDashboardStats();
  const { data: runsData, isLoading: runsLoading } = useAdminScoutRuns(10);

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold text-white">Dashboard</h1>
      <PasskeyBanner />

      {statsLoading ? (
        <div className="grid grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-20 animate-pulse rounded-xl bg-white/5" />
          ))}
        </div>
      ) : stats ? (
        <div className="grid grid-cols-4 gap-3">
          <StatCard label="Users" value={stats.totalUsers} />
          <StatCard label="Active Scouts" value={stats.activeScouts} />
          <StatCard label="AI Spend (Month)" value={`$${stats.aiSpendUsd.toFixed(2)}`} color="green" />
          <StatCard
            label="Scout Error Rate"
            value={`${(stats.scoutErrorRate * 100).toFixed(1)}%`}
            color={stats.scoutErrorRate > 0.1 ? "red" : stats.scoutErrorRate > 0.05 ? "amber" : "default"}
          />
        </div>
      ) : null}

      <div>
        <h2 className="font-mono text-xs uppercase tracking-wider text-white/50 font-semibold mb-3">
          Recent Scout Runs
        </h2>
        <DataTable
          loading={runsLoading}
          data={runsData?.runs ?? []}
          emptyMessage="No scout runs yet"
          columns={[
            { key: "scout", header: "Scout", render: (r: any) => r.scout?.name ?? "—" },
            {
              key: "status",
              header: "Status",
              render: (r: any) => (
                <span className={r.status === "success" ? "text-green-400" : r.status === "failed" ? "text-red-400" : "text-amber-400"}>
                  {r.status}
                </span>
              ),
            },
            { key: "findingsCount", header: "Findings" },
            { key: "tokensUsed", header: "Tokens", render: (r: any) => r.tokensUsed?.toLocaleString() ?? "—" },
            {
              key: "createdAt",
              header: "When",
              render: (r: any) => new Date(r.createdAt).toLocaleString(),
            },
          ]}
        />
      </div>
    </div>
  );
}
