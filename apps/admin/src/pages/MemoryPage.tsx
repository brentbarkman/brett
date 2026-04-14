import React from "react";
import { useMemoryStats, useMemoryUsers } from "../api/memory";
import { StatCard } from "../components/StatCard";
import { DataTable } from "../components/DataTable";

function CoverageBar({ label, coverage, embedded, total }: { label: string; coverage: number; embedded: number; total: number }) {
  const color = coverage >= 95 ? "bg-green-400" : coverage >= 80 ? "bg-amber-400" : "bg-red-400";
  return (
    <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="font-mono text-[11px] uppercase tracking-widest text-white/50">{label}</span>
        <span className="text-sm text-white/80">{embedded.toLocaleString()} / {total.toLocaleString()}</span>
      </div>
      <div className="h-2 rounded-full bg-white/[0.08] overflow-hidden">
        <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${Math.min(coverage, 100)}%` }} />
      </div>
      <div className="mt-1 text-right text-xs text-white/40">{coverage}%</div>
    </div>
  );
}

function SkeletonGrid({ count, cols = 4 }: { count: number; cols?: number }) {
  const gridClass = cols === 3 ? "grid-cols-3" : "grid-cols-4";
  return (
    <div className={`grid ${gridClass} gap-3`}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="h-20 animate-pulse rounded-xl bg-white/5" />
      ))}
    </div>
  );
}

export function MemoryPage() {
  const { data: stats, isLoading: statsLoading } = useMemoryStats();
  const { data: usersData, isLoading: usersLoading } = useMemoryUsers(15);

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold text-white">Memory System</h1>

      {/* Knowledge Graph */}
      <div>
        <h2 className="font-mono text-xs uppercase tracking-wider text-white/50 font-semibold mb-3">
          Knowledge Graph
        </h2>
        {statsLoading ? (
          <SkeletonGrid count={4} />
        ) : stats ? (
          <>
            <div className="grid grid-cols-4 gap-3">
              <StatCard label="Entities" value={stats.graph.totalEntities.toLocaleString()} />
              <StatCard label="Relationships" value={stats.graph.totalRelationships.toLocaleString()} />
              <StatCard label="New Entities (30d)" value={stats.graph.newEntities30d.toLocaleString()} color="green" />
              <StatCard label="New Rels (30d)" value={stats.graph.newRelationships30d.toLocaleString()} color="green" />
            </div>
            {stats.graph.entitiesByType.length > 0 && (
              <div className="mt-3 flex gap-3 flex-wrap">
                {stats.graph.entitiesByType.map((t) => (
                  <div key={t.type} className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-1.5 text-sm">
                    <span className="text-white/50">{t.type}</span>
                    <span className="ml-2 font-semibold text-white">{t.count}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : null}
      </div>

      {/* Embedding Coverage */}
      <div>
        <h2 className="font-mono text-xs uppercase tracking-wider text-white/50 font-semibold mb-3">
          Embedding Coverage
        </h2>
        {statsLoading ? (
          <SkeletonGrid count={3} cols={3} />
        ) : stats ? (
          <div className="grid grid-cols-3 gap-3">
            <CoverageBar label="Items" {...stats.embeddings.items} />
            <CoverageBar label="Calendar Events" {...stats.embeddings.calendarEvents} />
            <CoverageBar label="Meeting Notes" {...stats.embeddings.meetingNotes} />
          </div>
        ) : null}
      </div>

      {/* User Facts */}
      <div>
        <h2 className="font-mono text-xs uppercase tracking-wider text-white/50 font-semibold mb-3">
          User Facts
        </h2>
        {statsLoading ? (
          <SkeletonGrid count={3} cols={3} />
        ) : stats ? (
          <div className="grid grid-cols-3 gap-3">
            <StatCard label="Active Facts" value={stats.facts.active.toLocaleString()} />
            <StatCard label="Expired Facts" value={stats.facts.expired.toLocaleString()} />
            <StatCard label="New Facts (30d)" value={stats.facts.newLast30d.toLocaleString()} color="green" />
          </div>
        ) : null}
      </div>

      {/* Extraction Spend */}
      <div>
        <h2 className="font-mono text-xs uppercase tracking-wider text-white/50 font-semibold mb-3">
          Extraction Pipeline
        </h2>
        {statsLoading ? (
          <SkeletonGrid count={3} cols={3} />
        ) : stats ? (
          <div className="grid grid-cols-3 gap-3">
            <StatCard label="Total Calls" value={stats.extraction.totalCalls.toLocaleString()} />
            <StatCard label="Extraction Spend" value={`$${stats.extraction.totalSpendUsd.toFixed(2)}`} color="green" />
            <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4">
              <div className="font-mono text-[11px] uppercase tracking-widest text-white/50 mb-2">
                By Source
              </div>
              {Object.entries(stats.extraction.bySource).length === 0 ? (
                <div className="text-sm text-white/40">No extractions yet</div>
              ) : (
                <div className="space-y-1">
                  {Object.entries(stats.extraction.bySource).map(([source, data]) => (
                    <div key={source} className="flex justify-between text-sm">
                      <span className="text-white/60">{source.replace(/_/g, " ")}</span>
                      <span className="text-white/80">{data.calls} calls</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : null}
      </div>

      {/* Per-User Breakdown */}
      <div>
        <h2 className="font-mono text-xs uppercase tracking-wider text-white/50 font-semibold mb-3">
          Top Users by Memory Size
        </h2>
        <DataTable
          loading={usersLoading}
          data={usersData?.users ?? []}
          keyField="userId"
          emptyMessage="No users with memory data"
          columns={[
            { key: "name", header: "User", render: (u) => u.name ?? u.email },
            { key: "entityCount", header: "Entities", render: (u) => u.entityCount.toLocaleString() },
            { key: "relationshipCount", header: "Relationships", render: (u) => u.relationshipCount.toLocaleString() },
            { key: "factCount", header: "Active Facts", render: (u) => u.factCount.toLocaleString() },
            {
              key: "total",
              header: "Total",
              render: (u) => (u.entityCount + u.relationshipCount + u.factCount).toLocaleString(),
            },
          ]}
        />
      </div>
    </div>
  );
}
