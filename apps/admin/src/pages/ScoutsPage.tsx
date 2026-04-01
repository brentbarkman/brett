import React from "react";
import { useAdminScouts, useAdminScoutRuns, usePauseScout, useResumeScout, usePauseAllScouts, useResumeAllScouts } from "../api/scouts";
import { DataTable } from "../components/DataTable";
import { Pause, Play, ShieldAlert, ShieldCheck } from "lucide-react";

export function ScoutsPage() {
  const { data: scoutsData, isLoading: scoutsLoading } = useAdminScouts();
  const { data: runsData, isLoading: runsLoading } = useAdminScoutRuns();
  const pauseScout = usePauseScout();
  const resumeScout = useResumeScout();
  const pauseAll = usePauseAllScouts();
  const resumeAll = useResumeAllScouts();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-white">Scouts</h1>
        <div className="flex gap-2">
          <button
            onClick={() => { if (confirm("Pause ALL active scouts? This is a kill switch.")) pauseAll.mutate(); }}
            disabled={pauseAll.isPending}
            className="flex items-center gap-1.5 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-400 hover:bg-red-500/20 transition-colors disabled:opacity-30"
          >
            <ShieldAlert size={14} />
            Pause All
          </button>
          <button
            onClick={() => { if (confirm("Resume all kill-switch paused scouts?")) resumeAll.mutate(); }}
            disabled={resumeAll.isPending}
            className="flex items-center gap-1.5 rounded-lg border border-green-500/20 bg-green-500/10 px-3 py-1.5 text-xs font-medium text-green-400 hover:bg-green-500/20 transition-colors disabled:opacity-30"
          >
            <ShieldCheck size={14} />
            Resume All
          </button>
        </div>
      </div>

      <div>
        <h2 className="font-mono text-xs uppercase tracking-wider text-white/50 font-semibold mb-3">All Scouts</h2>
        <DataTable
          loading={scoutsLoading}
          data={scoutsData?.scouts ?? []}
          emptyMessage="No scouts"
          columns={[
            { key: "name", header: "Name", render: (s: any) => <span className="text-white/90">{s.name}</span> },
            { key: "owner", header: "Owner", render: (s: any) => s.user?.email ?? "—" },
            {
              key: "status",
              header: "Status",
              render: (s: any) => (
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                  s.status === "active" ? "bg-green-500/20 text-green-400"
                  : s.status === "paused" ? "bg-amber-500/20 text-amber-400"
                  : "bg-white/10 text-white/40"
                }`}>
                  {s.status}
                </span>
              ),
            },
            { key: "runs", header: "Runs", render: (s: any) => s._count?.runs ?? 0 },
            { key: "findings", header: "Findings", render: (s: any) => s._count?.findings ?? 0 },
            {
              key: "actions",
              header: "",
              render: (s: any) => (
                <div className="flex gap-1">
                  {s.status === "active" && (
                    <button
                      onClick={(e) => { e.stopPropagation(); pauseScout.mutate(s.id); }}
                      className="p-1 text-white/30 hover:text-amber-400 transition-colors"
                      title="Pause"
                    >
                      <Pause size={14} />
                    </button>
                  )}
                  {s.status === "paused" && (
                    <button
                      onClick={(e) => { e.stopPropagation(); resumeScout.mutate(s.id); }}
                      className="p-1 text-white/30 hover:text-green-400 transition-colors"
                      title="Resume"
                    >
                      <Play size={14} />
                    </button>
                  )}
                </div>
              ),
            },
          ]}
        />
      </div>

      <div>
        <h2 className="font-mono text-xs uppercase tracking-wider text-white/50 font-semibold mb-3">Recent Runs</h2>
        <DataTable
          loading={runsLoading}
          data={runsData?.runs ?? []}
          emptyMessage="No scout runs"
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
            { key: "durationMs", header: "Duration", render: (r: any) => r.durationMs ? `${(r.durationMs / 1000).toFixed(1)}s` : "—" },
            { key: "error", header: "Error", render: (r: any) => r.error ? <span className="text-red-400 truncate max-w-[200px] block">{r.error}</span> : "—" },
            { key: "createdAt", header: "When", render: (r: any) => new Date(r.createdAt).toLocaleString() },
          ]}
        />
      </div>
    </div>
  );
}
