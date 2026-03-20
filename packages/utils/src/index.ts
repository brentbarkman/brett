import type { CalendarGlassColor } from "@brett/types";

export function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function generateId(): string {
  return crypto.randomUUID();
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Convert a string to a URL-safe slug (lowercase, hyphens, preserves emoji and unicode) */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/[^\p{L}\p{N}\p{Emoji_Presentation}\p{Emoji}\u200d-]/gu, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Check if a URL is safe to render as an href (https/http only, no javascript: etc.) */
export function isSafeUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

// ── Calendar color mapping ──

/** Google's default calendar blue */
export const GOOGLE_DEFAULT_COLOR_HEX = "#4285f4";

interface GlassColorDefinition extends CalendarGlassColor {
  hue: number;
  hueRange: [number, number];
}

const GLASS_COLORS: GlassColorDefinition[] = [
  { name: "red", hue: 0, hueRange: [346, 15], bg: "rgba(239, 68, 68, 0.12)", border: "rgba(239, 68, 68, 0.25)", text: "rgb(252, 165, 165)" },
  { name: "orange", hue: 30, hueRange: [15, 40], bg: "rgba(249, 115, 22, 0.12)", border: "rgba(249, 115, 22, 0.25)", text: "rgb(253, 186, 116)" },
  { name: "amber", hue: 45, hueRange: [40, 55], bg: "rgba(245, 158, 11, 0.12)", border: "rgba(245, 158, 11, 0.25)", text: "rgb(252, 211, 77)" },
  { name: "green", hue: 142, hueRange: [100, 170], bg: "rgba(34, 197, 94, 0.12)", border: "rgba(34, 197, 94, 0.25)", text: "rgb(134, 239, 172)" },
  { name: "teal", hue: 175, hueRange: [170, 190], bg: "rgba(20, 184, 166, 0.12)", border: "rgba(20, 184, 166, 0.25)", text: "rgb(94, 234, 212)" },
  { name: "cyan", hue: 195, hueRange: [190, 210], bg: "rgba(6, 182, 212, 0.12)", border: "rgba(6, 182, 212, 0.25)", text: "rgb(103, 232, 249)" },
  { name: "blue", hue: 220, hueRange: [210, 250], bg: "rgba(59, 130, 246, 0.12)", border: "rgba(59, 130, 246, 0.25)", text: "rgb(147, 197, 253)" },
  { name: "indigo", hue: 260, hueRange: [250, 280], bg: "rgba(99, 102, 241, 0.12)", border: "rgba(99, 102, 241, 0.25)", text: "rgb(165, 180, 252)" },
  { name: "purple", hue: 290, hueRange: [280, 320], bg: "rgba(168, 85, 247, 0.12)", border: "rgba(168, 85, 247, 0.25)", text: "rgb(216, 180, 254)" },
  { name: "pink", hue: 335, hueRange: [320, 346], bg: "rgba(236, 72, 153, 0.12)", border: "rgba(236, 72, 153, 0.25)", text: "rgb(249, 168, 212)" },
];

const DEFAULT_GLASS: CalendarGlassColor = GLASS_COLORS.find((c) => c.name === "blue")!;

/** Convert hex color string to hue (0-360) */
export function hexToHue(hex: string): number {
  const cleaned = hex.replace("#", "");
  const r = parseInt(cleaned.substring(0, 2), 16) / 255;
  const g = parseInt(cleaned.substring(2, 4), 16) / 255;
  const b = parseInt(cleaned.substring(4, 6), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;

  if (delta === 0) return 0;

  let hue: number;
  if (max === r) {
    hue = ((g - b) / delta) % 6;
  } else if (max === g) {
    hue = (b - r) / delta + 2;
  } else {
    hue = (r - g) / delta + 4;
  }

  hue = Math.round(hue * 60);
  if (hue < 0) hue += 360;
  return hue;
}

/** Map a Google hex color to the nearest glass morphism color */
export function googleColorToGlass(hex: string): CalendarGlassColor {
  const hue = hexToHue(hex);

  for (const color of GLASS_COLORS) {
    const [low, high] = color.hueRange;
    if (low > high) {
      if (hue >= low || hue < high) {
        return { bg: color.bg, border: color.border, text: color.text, name: color.name };
      }
    } else {
      if (hue >= low && hue < high) {
        return { bg: color.bg, border: color.border, text: color.text, name: color.name };
      }
    }
  }

  return DEFAULT_GLASS;
}

/** Resolve a calendar event's display color from its calendarColor hex */
export function getEventGlassColor(calendarColor: string | undefined | null): CalendarGlassColor {
  return googleColorToGlass(calendarColor ?? GOOGLE_DEFAULT_COLOR_HEX);
}
