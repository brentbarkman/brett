import React from "react";
import { BookOpen, Scale, TrendingUp, X } from "lucide-react";
import type { ScoutMemory, ScoutMemoryType } from "@brett/types";
import { formatRelativeTime } from "@brett/utils";

interface ScoutMemoryTabProps {
  memories: ScoutMemory[];
  isLoading: boolean;
  onDelete: (memoryId: string) => void;
}

const TYPE_CONFIG: Record<
  ScoutMemoryType,
  {
    label: string;
    sectionTitle: string;
    icon: React.ReactNode;
    badgeBg: string;
    badgeText: string;
    barColor: string;
  }
> = {
  factual: {
    label: "Factual",
    sectionTitle: "Factual Knowledge",
    icon: <BookOpen size={14} />,
    badgeBg: "bg-purple-500/15",
    badgeText: "text-purple-400",
    barColor: "bg-purple-400/40",
  },
  judgment: {
    label: "Judgment",
    sectionTitle: "Judgment & Preferences",
    icon: <Scale size={14} />,
    badgeBg: "bg-blue-500/15",
    badgeText: "text-blue-400",
    barColor: "bg-blue-400/40",
  },
  pattern: {
    label: "Pattern",
    sectionTitle: "Patterns & Trends",
    icon: <TrendingUp size={14} />,
    badgeBg: "bg-amber-500/15",
    badgeText: "text-amber-400",
    barColor: "bg-amber-400/40",
  },
};

const SECTION_ORDER: ScoutMemoryType[] = ["factual", "judgment", "pattern"];

export function ScoutMemoryTab({ memories, isLoading, onDelete }: ScoutMemoryTabProps) {
  if (isLoading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-20 rounded-xl bg-white/[0.03] border border-white/[0.06] animate-pulse" />
        ))}
      </div>
    );
  }

  if (memories.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-sm text-white/30">This scout is still learning.</p>
        <p className="text-xs text-white/20 mt-1">Memories will appear after a few runs.</p>
      </div>
    );
  }

  const grouped = SECTION_ORDER.map((type) => ({
    type,
    config: TYPE_CONFIG[type],
    items: memories.filter((m) => m.type === type),
  })).filter((section) => section.items.length > 0);

  return (
    <div className="space-y-6">
      {grouped.map((section) => (
        <div key={section.type} className="space-y-2">
          <h3 className="text-xs text-white/40 uppercase tracking-wide font-medium">
            {section.config.sectionTitle}
          </h3>
          {section.items.map((memory) => (
            <MemoryCard
              key={memory.id}
              memory={memory}
              config={section.config}
              onDelete={onDelete}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function MemoryCard({
  memory,
  config,
  onDelete,
}: {
  memory: ScoutMemory;
  config: (typeof TYPE_CONFIG)[ScoutMemoryType];
  onDelete: (memoryId: string) => void;
}) {
  return (
    <div className="group flex gap-3.5 p-4 rounded-xl bg-white/[0.03] border border-white/[0.06] hover:bg-white/[0.05] transition-colors">
      <div
        className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${config.badgeBg}`}
      >
        <span className={config.badgeText}>{config.icon}</span>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[13px] text-white/80 leading-relaxed">{memory.content}</p>
        <div className="h-0.5 rounded-full bg-white/[0.06] mt-2">
          <div
            className={`h-full rounded-full ${config.barColor}`}
            style={{ width: `${Math.round(memory.confidence * 100)}%` }}
          />
        </div>
        <div className="text-[11px] text-white/30 mt-1.5">
          Updated {formatRelativeTime(memory.updatedAt)}
        </div>
      </div>
      <button
        onClick={() => onDelete(memory.id)}
        className="flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-md opacity-0 group-hover:opacity-100 hover:bg-white/[0.06] text-white/30 hover:text-white/50 transition-all"
      >
        <X size={14} />
      </button>
    </div>
  );
}
