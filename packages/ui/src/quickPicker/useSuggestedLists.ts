import { useMemo } from "react";
import type { NavList } from "@brett/types";

interface AiSuggestion {
  listId: string;
  listName: string;
  similarity: number;
}

interface Args {
  lists: NavList[];
  aiSuggestions: AiSuggestion[] | undefined;
  recentListIds: string[];
}

interface Result {
  chips: NavList[];
  mode: "suggested" | "recent" | "empty";
}

const MAX_CHIPS = 4;

export function useSuggestedLists({
  lists,
  aiSuggestions,
  recentListIds,
}: Args): Result {
  return useMemo(() => {
    const byId = new Map(lists.map((l) => [l.id, l]));

    if (aiSuggestions && aiSuggestions.length > 0) {
      const chips = aiSuggestions
        .map((s) => byId.get(s.listId))
        .filter((l): l is NavList => !!l)
        .slice(0, MAX_CHIPS);
      if (chips.length > 0) return { chips, mode: "suggested" };
    }

    const chips = recentListIds
      .map((id) => byId.get(id))
      .filter((l): l is NavList => !!l)
      .slice(0, MAX_CHIPS);

    return { chips, mode: chips.length > 0 ? "recent" : "empty" };
  }, [lists, aiSuggestions, recentListIds]);
}
