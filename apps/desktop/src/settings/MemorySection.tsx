import React, { useState } from "react";
import { Brain, Trash2 } from "lucide-react";
import { useUserFacts, useDeleteUserFact } from "../api/user-facts";
import { useAIConfigs } from "../api/ai-config";

const CATEGORY_LABELS: Record<string, { label: string; color: string }> = {
  preference: { label: "Preference", color: "text-blue-400" },
  context: { label: "Context", color: "text-green-400" },
  relationship: { label: "Relationship", color: "text-purple-400" },
  habit: { label: "Habit", color: "text-amber-400" },
};

function FactRow({
  fact,
  onDelete,
  isDeleting,
}: {
  fact: { id: string; category: string; key: string; value: string };
  onDelete: () => void;
  isDeleting: boolean;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const categoryInfo = CATEGORY_LABELS[fact.category] ?? {
    label: fact.category,
    color: "text-white/40",
  };

  return (
    <div className="flex items-start justify-between gap-3 px-3 py-2.5 bg-white/5 rounded-lg">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 mb-0.5">
          <span className={`text-[10px] uppercase tracking-wider font-semibold ${categoryInfo.color}`}>
            {categoryInfo.label}
          </span>
        </div>
        <p className="text-sm text-white/80 leading-relaxed">{fact.value}</p>
      </div>

      <div className="flex items-center flex-shrink-0 mt-0.5">
        {confirmDelete ? (
          <div className="flex items-center gap-2">
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
          </div>
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

export function MemorySection() {
  const { data, isLoading, error } = useUserFacts();
  const deleteFact = useDeleteUserFact();
  const { data: aiConfigData } = useAIConfigs();
  const hasAI = (aiConfigData?.configs ?? []).some((c) => c.isActive && c.isValid);

  const facts = data?.facts ?? [];

  return (
    <div className="bg-black/30 backdrop-blur-xl rounded-xl border border-white/10 p-6">
      {/* Header */}
      <div className="mb-4">
        <h3 className="text-xs uppercase tracking-wider text-white/40 font-semibold">
          Memory
        </h3>
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
          Failed to load memory.
        </div>
      )}

      {/* Facts list */}
      {!isLoading && facts.length > 0 && (
        <div className="space-y-2">
          {facts.map((fact) => (
            <FactRow
              key={fact.id}
              fact={fact}
              onDelete={() => deleteFact.mutate(fact.id)}
              isDeleting={
                deleteFact.isPending && deleteFact.variables === fact.id
              }
            />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && !error && facts.length === 0 && (
        <div className="flex flex-col items-center gap-2 py-4 text-center">
          <Brain size={24} className="text-white/20" />
          <p className="text-xs text-white/30">
            {hasAI
              ? "Brett hasn't learned anything about you yet. It will pick up on your preferences as you chat."
              : "Configure an AI provider above to enable Brett's memory."}
          </p>
        </div>
      )}
    </div>
  );
}
