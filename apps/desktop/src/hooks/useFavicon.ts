import { useEffect, useRef } from "react";

type FaviconMode = "default" | "working";

/**
 * Dynamic favicon with count badge:
 * - count = 0          → base product mark
 * - count > 0          → product mark + cerulean badge with count
 * - mode = "working"   → Brett's mark (AI streaming), no badge
 */
export function useFavicon(mode: FaviconMode, count: number) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!link) return;

    // Working mode uses a static SVG — no badge needed
    if (mode === "working") {
      link.href = "/favicon-working.svg";
      return;
    }

    // No items — use the base favicon directly
    if (count <= 0) {
      link.href = "/favicon.svg";
      return;
    }

    // Draw base favicon + count badge on canvas
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

      // Badge config — oversized so it's legible at 16px tab favicon
      const label = count > 99 ? "99+" : String(count);
      const fontSize = label.length >= 3 ? 22 : label.length === 2 ? 28 : 32;
      ctx.font = `bold ${fontSize}px -apple-system, "Helvetica Neue", sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      const textMetrics = ctx.measureText(label);
      const textWidth = textMetrics.width;
      const badgeHeight = 30;
      const badgePadding = 7;
      const badgeWidth = Math.max(badgeHeight, textWidth + badgePadding * 2);
      const badgeX = size - badgeWidth / 2 - 1;
      const badgeY = badgeHeight / 2 + 1;

      // Badge background — cerulean blue
      ctx.beginPath();
      if (badgeWidth === badgeHeight) {
        ctx.arc(badgeX, badgeY, badgeHeight / 2, 0, Math.PI * 2);
      } else {
        const r = badgeHeight / 2;
        const left = badgeX - badgeWidth / 2;
        const right = badgeX + badgeWidth / 2;
        const top = badgeY - r;
        const bottom = badgeY + r;
        ctx.moveTo(left + r, top);
        ctx.lineTo(right - r, top);
        ctx.arcTo(right, top, right, badgeY, r);
        ctx.arcTo(right, bottom, right - r, bottom, r);
        ctx.lineTo(left + r, bottom);
        ctx.arcTo(left, bottom, left, badgeY, r);
        ctx.arcTo(left, top, left + r, top, r);
      }
      ctx.fillStyle = "#4682C3";
      ctx.fill();

      // Badge text — white
      ctx.fillStyle = "#FFFFFF";
      ctx.fillText(label, badgeX, badgeY + 1);

      link.href = canvas.toDataURL("image/png");
    };
    img.src = "/favicon.svg";
  }, [mode, count]);
}
