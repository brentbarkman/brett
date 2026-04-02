import { useEffect } from "react";

type FaviconState = "default" | "active" | "working";

/**
 * Swaps the favicon based on app state:
 * - "default"  → product mark (no items)
 * - "active"   → product mark + gold badge dot (has items in today)
 * - "working"  → Brett's mark (AI is streaming)
 */
export function useFavicon(state: FaviconState) {
  useEffect(() => {
    const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!link) return;

    const paths: Record<FaviconState, string> = {
      default: "/favicon.svg",
      active: "/favicon-active.svg",
      working: "/favicon-working.svg",
    };

    link.href = paths[state];
  }, [state]);
}
