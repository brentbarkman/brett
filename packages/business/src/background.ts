export type TimeSegment = "dawn" | "morning" | "afternoon" | "goldenHour" | "evening" | "night";
export type BusynessTier = "light" | "moderate" | "packed";

export function getTimeSegment(hour: number): TimeSegment {
  if (hour >= 5 && hour < 7) return "dawn";
  if (hour >= 7 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 19) return "goldenHour";
  if (hour >= 19 && hour < 21) return "evening";
  return "night";
}

/**
 * Compute busyness tier. When avgScore is provided, tiers are relative
 * to the user's normal workload. Otherwise falls back to fixed thresholds.
 */
export function getBusynessTier(
  meetingCount: number,
  taskCount: number,
  avgScore?: number,
): BusynessTier {
  const score = meetingCount * 2 + taskCount;

  // Relative mode: compare today to user's 14-day average
  if (avgScore && avgScore > 0) {
    const ratio = score / avgScore;
    if (ratio < 0.7) return "light";
    if (ratio <= 1.3) return "moderate";
    return "packed";
  }

  // Fixed fallback for new users with no history
  if (score <= 4) return "light";
  if (score <= 10) return "moderate";
  return "packed";
}

/** Raw busyness score — used for computing averages */
export function getBusynessScore(meetingCount: number, taskCount: number): number {
  return meetingCount * 2 + taskCount;
}

export type BackgroundStyle = "photography" | "abstract" | "solid";

export interface BackgroundManifest {
  version: number;
  sets: Record<string, Record<string, Record<string, string[]>>>;
}

/**
 * Where the portrait pipeline should focus when cropping a landscape source
 * to a portrait frame. Values are sharp's `position` option names.
 * Defaults to "attention" (entropy-based smart crop) when unset.
 */
export type CropFocus =
  | "center"
  | "top"
  | "right"
  | "bottom"
  | "left"
  | "top left"
  | "top right"
  | "bottom left"
  | "bottom right"
  | "entropy"
  | "attention";

/**
 * Per-image credit + metadata. Keyed by the landscape slot path
 * (e.g. "photo/dawn/light-1.webp") in the attributions JSON.
 */
export interface ImageAttribution {
  photographer: string | null;
  unsplashId: string | null;
  unsplashUrl: string | null;
  /** Freeform note, e.g. "original curated set" for legacy images. */
  note?: string;
  /** Override the default crop focus for the portrait pipeline. */
  cropFocus?: CropFocus;
}

export type ImageAttributions = Record<string, ImageAttribution>;

export function selectImage(
  manifest: BackgroundManifest,
  style: BackgroundStyle,
  segment: TimeSegment,
  tier: BusynessTier,
  excludeUrls: string[],
): string | null {
  const images = manifest.sets[style]?.[segment]?.[tier];
  if (!images || images.length === 0) return null;

  let available = images.filter((url) => !excludeUrls.includes(url));

  if (available.length === 0) {
    available = images;
  }

  return available[Math.floor(Math.random() * available.length)];
}
