import { useEffect, useRef } from "react";

type FaviconMode = "default" | "working";

/**
 * Dynamic favicon:
 * - count = 0          → base product mark
 * - count > 0          → product mark + small cerulean dot (unread indicator,
 *                         no numeral — numerals were illegible at 16px tab size)
 * - mode = "working"   → Brett's mark (AI streaming), no dot
 */
export function useFavicon(mode: FaviconMode, count: number) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!link) return;

    // Working mode uses a static SVG — no dot needed
    if (mode === "working") {
      link.href = "/favicon-working.svg";
      return;
    }

    // No items — use the base favicon directly
    if (count <= 0) {
      link.href = "/favicon.svg";
      return;
    }

    // Draw base favicon + unread dot on canvas
    if (!canvasRef.current) {
      canvasRef.current = document.createElement("canvas");
      canvasRef.current.width = 64;
      canvasRef.current.height = 64;
    }
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const img = new Image();
    img.onload = () => {
      const size = canvas.width;
      ctx.clearRect(0, 0, size, size);
      ctx.drawImage(img, 0, 0, size, size);

      // Unread dot — top-right. Sized so it reads as a dot at 16px tab favicon
      // (the favicon is downscaled ~4x, so a 16px dot renders as ~4px on-screen).
      const dotRadius = 16;
      const dotX = size - dotRadius - 2;
      const dotY = dotRadius + 2;

      // Subtle ring against busy icon colors, then the cerulean fill
      ctx.beginPath();
      ctx.arc(dotX, dotY, dotRadius, 0, Math.PI * 2);
      ctx.fillStyle = "#0C0F15"; // brett-bg — dark ring so the dot pops on any backdrop
      ctx.fill();

      ctx.beginPath();
      ctx.arc(dotX, dotY, dotRadius - 3, 0, Math.PI * 2);
      ctx.fillStyle = "#4682C3"; // brett-cerulean
      ctx.fill();

      link.href = canvas.toDataURL("image/png");
    };
    img.src = "/favicon.svg";
  }, [mode, count]);
}
