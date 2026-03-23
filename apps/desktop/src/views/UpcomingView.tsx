import React, { useState, useMemo } from "react";
import { Clock } from "lucide-react";
import { ThingCard, ItemListShell, useListKeyboardNav, SkeletonListView, SectionHeader, TypeFilter } from "@brett/ui";
import type { Thing, FilterType } from "@brett/types";
import { groupUpcomingThings } from "@brett/business";
import { useUpcomingThings, useToggleThing } from "../api/things";

interface UpcomingViewProps {
  onItemClick: (item: Thing) => void;
  onTriageOpen: (mode: "list-first" | "date-first", ids: string[], thing?: { listId?: string | null; dueDate?: string; dueDatePrecision?: "day" | "week" | null }) => void;
  onFocusChange?: (thing: Thing) => void;
}

export function UpcomingView({ onItemClick, onTriageOpen, onFocusChange }: UpcomingViewProps) {
  const [typeFilter, setTypeFilter] = useState<FilterType>("All");
  const { data: things = [], isLoading } = useUpcomingThings();
  const toggleThing = useToggleThing();

  const filteredThings = useMemo(() => {
    if (typeFilter === "All") return things;
    if (typeFilter === "Tasks") return things.filter((t) => t.type === "task");
    if (typeFilter === "Content") return things.filter((t) => t.type === "content");
    return things;
  }, [things, typeFilter]);

  const sections = groupUpcomingThings(filteredThings);
  const allItems = sections.flatMap((s) => s.things);

  const handleToggle = (id: string) => {
    toggleThing.mutate(id);
  };

  const { focusedIndex, setFocusedIndex } = useListKeyboardNav({
    items: allItems,
    onItemClick,
    onToggle: handleToggle,
    onFocusChange,
    onExtraKey: (e, focusedThing) => {
      if (!focusedThing) return false;
      if (e.key === "l") {
        e.preventDefault();
        onTriageOpen("list-first", [focusedThing.id], focusedThing);
        return true;
      }
      if (e.key === "d") {
        e.preventDefault();
        onTriageOpen("date-first", [focusedThing.id], focusedThing);
        return true;
      }
      return false;
    },
  });

  const header = (
    <>
      <div className="flex items-center gap-3">
        <Clock size={20} className="text-white/50" />
        <h2 className="text-xl font-bold text-white">Upcoming</h2>
      </div>
      <TypeFilter value={typeFilter} onChange={setTypeFilter} />
    </>
  );

  const hints = allItems.length > 0
    ? ["j/k navigate", "l list", "d date", "e done"]
    : [];

  if (isLoading) {
    return <SkeletonListView />;
  }

  return (
    <ItemListShell header={header} hints={hints}>
      {allItems.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 gap-4">
          <div className="w-12 h-12 rounded-full bg-white/5 border border-white/10 flex items-center justify-center">
            <Clock size={22} className="text-white/40" />
          </div>
          <div className="text-center">
            <h3 className="text-white font-semibold text-base mb-1">Clear skies ahead</h3>
            <p className="text-white/40 text-sm leading-relaxed max-w-xs">
              Nothing scheduled. Set due dates on items to plan your week.
            </p>
          </div>
        </div>
      )}

      {sections.map((section, sectionIdx) => {
        let offset = 0;
        for (let i = 0; i < sectionIdx; i++) {
          offset += sections[i].things.length;
        }

        return (
          <div key={section.label} className={sectionIdx > 0 ? "mt-4" : ""}>
            <SectionHeader title={section.label} />
            <div className="flex flex-col gap-2">
              {section.things.map((thing, i) => (
                <ThingCard
                  key={thing.id}
                  thing={thing}
                  onClick={() => onItemClick(thing)}
                  onToggle={handleToggle}
                  onFocus={() => setFocusedIndex(offset + i)}
                  isFocused={focusedIndex === offset + i}
                />
              ))}
            </div>
          </div>
        );
      })}
    </ItemListShell>
  );
}
