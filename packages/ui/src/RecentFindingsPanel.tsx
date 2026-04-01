import React from "react";
import { formatRelativeTime } from "@brett/utils";

export interface RecentFindingItem {
  id: string;
  scoutId: string;
  itemId?: string;
  type: string;
  title: string;
  sourceName: string;
  createdAt: string;
  scoutName: string;
  scoutAvatarGradient: [string, string];
}

interface RecentFindingsPanelProps {
  findings: RecentFindingItem[];
  onFindingClick?: (finding: RecentFindingItem) => void;
  isLoading?: boolean;
}

export function RecentFindingsPanel({
  findings,
  onFindingClick,
  isLoading,
}: RecentFindingsPanelProps) {
  if (isLoading) {
    return (
      <div className="w-[280px] flex-shrink-0 bg-black/30 backdrop-blur-xl rounded-xl border border-white/10 p-4">
        <div className="text-[9px] uppercase tracking-[1px] text-white/40 font-semibold mb-4">
          Recent Findings
        </div>
        <div className="space-y-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="flex gap-2.5">
              <div className="w-[6px] h-[6px] rounded-full bg-white/10 mt-1.5 flex-shrink-0 animate-pulse" />
              <div className="flex-1 space-y-1.5">
                <div className="h-3 bg-white/5 rounded animate-pulse w-4/5" />
                <div className="h-2.5 bg-white/5 rounded animate-pulse w-2/5" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (findings.length === 0) {
    return (
      <div className="w-[280px] flex-shrink-0 bg-black/30 backdrop-blur-xl rounded-xl border border-white/10 p-4">
        <div className="text-[9px] uppercase tracking-[1px] text-white/40 font-semibold mb-4">
          Recent Findings
        </div>
        <p className="text-[11px] text-white/30 text-center py-8">
          No findings yet. Scouts will surface findings as they run.
        </p>
      </div>
    );
  }

  return (
    <div className="w-[280px] flex-shrink-0 bg-black/30 backdrop-blur-xl rounded-xl border border-white/10 p-4 overflow-y-auto scrollbar-hide">
      <div className="text-[9px] uppercase tracking-[1px] text-white/40 font-semibold mb-4">
        Recent Findings
      </div>
      <div className="space-y-4">
        {findings.map((finding) => (
          <button
            key={finding.id}
            onClick={() => onFindingClick?.(finding)}
            className="flex gap-2.5 w-full text-left group"
          >
            <div
              className="w-[6px] h-[6px] rounded-full mt-1.5 flex-shrink-0"
              style={{ background: finding.scoutAvatarGradient[0] }}
            />
            <div className="flex-1 min-w-0">
              <p className="text-[11px] text-white/60 font-medium leading-snug group-hover:text-white/80 transition-colors line-clamp-2">
                {finding.title}
              </p>
              <p className="text-[10px] text-white/30 mt-1">
                {finding.scoutName} · {formatRelativeTime(finding.createdAt)}
              </p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
