import { useEffect } from "react";

type FaviconMode = "default" | "working";

/**
 * Dynamic favicon:
 * - count = 0          → base product mark (`/favicon.svg`)
 * - count > 0          → mark + cerulean dot (`/favicon-active.svg`)
 * - mode = "working"   → Brett's mark while AI is streaming (`/favicon-working.svg`)
 *
 * All three are static SVGs — browsers rasterize them natively at tab size
 * (16×16), which is crisper than any canvas/PNG composite of the same content.
 */
export function useFavicon(mode: FaviconMode, count: number) {
  useEffect(() => {
    const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!link) return;

    if (mode === "working") {
      link.href = "/favicon-working.svg";
      return;
    }
    if (count > 0) {
      link.href = "/favicon-active.svg";
      return;
    }
    link.href = "/favicon.svg";
  }, [mode, count]);
}
