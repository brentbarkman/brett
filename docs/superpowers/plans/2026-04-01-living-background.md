# Living Background System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the static Unsplash background with a dynamic system that shifts images based on time of day and workload intensity.

**Architecture:** Client-side image selection driven by a JSON manifest. A `useBackground` hook computes the current time segment (6 segments) and busyness tier (3 tiers from task+meeting counts), selects an image from the manifest, and manages crossfade rotation. A `LivingBackground` component renders two `<img>` layers for smooth crossfades plus readability overlays.

**Tech Stack:** React, TypeScript, Tailwind CSS, Prisma, Hono, Vitest, Railway Object Storage

**Spec:** `docs/superpowers/specs/2026-04-01-living-background-design.md`

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `packages/business/src/background.ts` | Pure functions: `getTimeSegment()`, `getBusynessTier()`, `selectImage()` |
| Create | `packages/business/src/__tests__/background.test.ts` | Tests for all pure functions |
| Create | `apps/desktop/src/data/background-manifest.json` | Image manifest (sets × segments × tiers → file paths) |
| Create | `apps/desktop/src/hooks/useBackground.ts` | Hook: time detection, busyness, rotation, crossfade state |
| Create | `apps/desktop/src/hooks/useAppConfig.ts` | Hook: fetch `/config` for storage base URL |
| Create | `packages/ui/src/LivingBackground.tsx` | Component: two `<img>` crossfade layers + vignette + left scrim |
| Create | `apps/desktop/src/settings/BackgroundSection.tsx` | Settings UI: photography/abstract toggle |
| Create | `apps/desktop/src/assets/fallback-bg.webp` | Bundled fallback image for offline/first-load |
| Modify | `apps/api/prisma/schema.prisma` | Add `backgroundStyle` column to User model |
| Modify | `apps/api/src/routes/users.ts` | Add `backgroundStyle` to GET /users/me and PATCH /users/location |
| Modify | `apps/desktop/src/App.tsx:811-828` | Replace 3 hardcoded background divs with `<LivingBackground />` |
| Modify | `apps/desktop/src/settings/SettingsPage.tsx` | Add `<BackgroundSection />` to Preferences tab |
| Modify | `packages/business/src/index.ts` | Re-export background functions |

---

### Task 1: Pure Logic — Time Segments and Busyness Tiers

**Files:**
- Create: `packages/business/src/background.ts`
- Create: `packages/business/src/__tests__/background.test.ts`
- Modify: `packages/business/src/index.ts`

- [ ] **Step 1: Write failing tests for `getTimeSegment`**

```typescript
// packages/business/src/__tests__/background.test.ts
import { describe, it, expect } from "vitest";
import { getTimeSegment } from "../background";

describe("getTimeSegment", () => {
  it("returns dawn for 5am-6:59am", () => {
    expect(getTimeSegment(5)).toBe("dawn");
    expect(getTimeSegment(6)).toBe("dawn");
  });

  it("returns morning for 7am-11:59am", () => {
    expect(getTimeSegment(7)).toBe("morning");
    expect(getTimeSegment(11)).toBe("morning");
  });

  it("returns afternoon for 12pm-4:59pm", () => {
    expect(getTimeSegment(12)).toBe("afternoon");
    expect(getTimeSegment(16)).toBe("afternoon");
  });

  it("returns goldenHour for 5pm-6:59pm", () => {
    expect(getTimeSegment(17)).toBe("goldenHour");
    expect(getTimeSegment(18)).toBe("goldenHour");
  });

  it("returns evening for 7pm-8:59pm", () => {
    expect(getTimeSegment(19)).toBe("evening");
    expect(getTimeSegment(20)).toBe("evening");
  });

  it("returns night for 9pm-4:59am", () => {
    expect(getTimeSegment(21)).toBe("night");
    expect(getTimeSegment(0)).toBe("night");
    expect(getTimeSegment(4)).toBe("night");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/business && pnpm vitest run src/__tests__/background.test.ts`
Expected: FAIL — `getTimeSegment` not found

- [ ] **Step 3: Write failing tests for `getBusynessTier`**

Add to the same test file:

```typescript
import { getBusynessTier } from "../background";

describe("getBusynessTier", () => {
  it("returns light when score <= 4", () => {
    expect(getBusynessTier(0, 0)).toBe("light");     // score = 0
    expect(getBusynessTier(1, 2)).toBe("light");     // score = 4
    expect(getBusynessTier(0, 4)).toBe("light");     // score = 4
    expect(getBusynessTier(2, 0)).toBe("light");     // score = 4
  });

  it("returns moderate when score 5-10", () => {
    expect(getBusynessTier(1, 3)).toBe("moderate");  // score = 5
    expect(getBusynessTier(3, 2)).toBe("moderate");  // score = 8
    expect(getBusynessTier(5, 0)).toBe("moderate");  // score = 10
    expect(getBusynessTier(0, 10)).toBe("moderate"); // score = 10
  });

  it("returns packed when score > 10", () => {
    expect(getBusynessTier(3, 5)).toBe("packed");    // score = 11
    expect(getBusynessTier(5, 1)).toBe("packed");    // score = 11
    expect(getBusynessTier(6, 0)).toBe("packed");    // score = 12
    expect(getBusynessTier(0, 11)).toBe("packed");   // score = 11
  });

  it("weights meetings at 2x", () => {
    // 3 meetings + 0 tasks = 6 (moderate)
    expect(getBusynessTier(3, 0)).toBe("moderate");
    // 0 meetings + 6 tasks = 6 (moderate)
    expect(getBusynessTier(0, 6)).toBe("moderate");
    // Same total but meetings push it higher:
    // 4 meetings + 3 tasks = 11 (packed)
    expect(getBusynessTier(4, 3)).toBe("packed");
    // 0 meetings + 11 tasks = 11 (packed)
    expect(getBusynessTier(0, 11)).toBe("packed");
  });
});
```

- [ ] **Step 4: Implement `getTimeSegment` and `getBusynessTier`**

```typescript
// packages/business/src/background.ts

export type TimeSegment = "dawn" | "morning" | "afternoon" | "goldenHour" | "evening" | "night";
export type BusynessTier = "light" | "moderate" | "packed";

/**
 * Map a 0-23 hour to a time segment.
 */
export function getTimeSegment(hour: number): TimeSegment {
  if (hour >= 5 && hour < 7) return "dawn";
  if (hour >= 7 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 19) return "goldenHour";
  if (hour >= 19 && hour < 21) return "evening";
  return "night";
}

/**
 * Compute busyness tier from today's meetings and tasks.
 * Formula: score = (meetings × 2) + tasks
 */
export function getBusynessTier(meetingCount: number, taskCount: number): BusynessTier {
  const score = (meetingCount * 2) + taskCount;
  if (score <= 4) return "light";
  if (score <= 10) return "moderate";
  return "packed";
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/business && pnpm vitest run src/__tests__/background.test.ts`
Expected: All tests PASS

- [ ] **Step 6: Re-export from index**

Add to `packages/business/src/index.ts`:

```typescript
export { getTimeSegment, getBusynessTier, type TimeSegment, type BusynessTier } from "./background";
```

- [ ] **Step 7: Commit**

```bash
git add packages/business/src/background.ts packages/business/src/__tests__/background.test.ts packages/business/src/index.ts
git commit -m "feat(background): add time segment and busyness tier pure functions with tests"
```

---

### Task 2: Pure Logic — Image Selection

**Files:**
- Modify: `packages/business/src/background.ts`
- Modify: `packages/business/src/__tests__/background.test.ts`
- Modify: `packages/business/src/index.ts`

- [ ] **Step 1: Write failing tests for `selectImage`**

Add to `packages/business/src/__tests__/background.test.ts`:

```typescript
import { selectImage } from "../background";

describe("selectImage", () => {
  const manifest = {
    version: 1,
    sets: {
      photography: {
        dawn: {
          light: ["dawn/light-1.webp", "dawn/light-2.webp", "dawn/light-3.webp"],
          moderate: ["dawn/moderate-1.webp"],
          packed: ["dawn/packed-1.webp", "dawn/packed-2.webp"],
        },
      },
      abstract: {
        dawn: {
          light: ["abstract/dawn/light-1.webp"],
          moderate: ["abstract/dawn/moderate-1.webp"],
          packed: ["abstract/dawn/packed-1.webp"],
        },
      },
    },
  };

  it("returns a URL from the correct category", () => {
    const result = selectImage(manifest, "photography", "dawn", "light", []);
    expect(manifest.sets.photography.dawn.light).toContain(result);
  });

  it("excludes already-shown images", () => {
    const exclude = ["dawn/light-1.webp", "dawn/light-2.webp"];
    const result = selectImage(manifest, "photography", "dawn", "light", exclude);
    expect(result).toBe("dawn/light-3.webp");
  });

  it("resets exclusion when all images have been shown", () => {
    const exclude = ["dawn/light-1.webp", "dawn/light-2.webp", "dawn/light-3.webp"];
    const result = selectImage(manifest, "photography", "dawn", "light", exclude);
    expect(manifest.sets.photography.dawn.light).toContain(result);
  });

  it("works with abstract set", () => {
    const result = selectImage(manifest, "abstract", "dawn", "light", []);
    expect(result).toBe("abstract/dawn/light-1.webp");
  });

  it("returns null for missing category", () => {
    const result = selectImage(manifest, "photography", "morning" as any, "light", []);
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/business && pnpm vitest run src/__tests__/background.test.ts`
Expected: FAIL — `selectImage` not found

- [ ] **Step 3: Implement `selectImage`**

Add to `packages/business/src/background.ts`:

```typescript
export type BackgroundStyle = "photography" | "abstract";

export interface BackgroundManifest {
  version: number;
  sets: Record<string, Record<string, Record<string, string[]>>>;
}

/**
 * Select an image from the manifest, excluding already-shown images.
 * Returns null if the category doesn't exist.
 * Resets exclusion list when all images in category have been shown.
 */
export function selectImage(
  manifest: BackgroundManifest,
  style: BackgroundStyle,
  segment: TimeSegment,
  tier: BusynessTier,
  excludeUrls: string[],
): string | null {
  const images = manifest.sets[style]?.[segment]?.[tier];
  if (!images || images.length === 0) return null;

  // Filter out already-shown images
  let available = images.filter((url) => !excludeUrls.includes(url));

  // If all shown, reset (shuffle without replacement cycle complete)
  if (available.length === 0) {
    available = images;
  }

  // Random pick from available
  return available[Math.floor(Math.random() * available.length)];
}
```

- [ ] **Step 4: Re-export from index**

Update the export in `packages/business/src/index.ts`:

```typescript
export {
  getTimeSegment,
  getBusynessTier,
  selectImage,
  type TimeSegment,
  type BusynessTier,
  type BackgroundStyle,
  type BackgroundManifest,
} from "./background";
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/business && pnpm vitest run src/__tests__/background.test.ts`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add packages/business/src/background.ts packages/business/src/__tests__/background.test.ts packages/business/src/index.ts
git commit -m "feat(background): add image selection with shuffle-without-replacement"
```

---

### Task 3: Background Manifest

**Files:**
- Create: `apps/desktop/src/data/background-manifest.json`

- [ ] **Step 1: Create the manifest with placeholder image paths**

Create `apps/desktop/src/data/background-manifest.json`. This is the full 18-category structure for both sets. Image files will be uploaded to Railway storage separately. Use descriptive filenames that match the mood mapping from the spec.

```json
{
  "version": 1,
  "sets": {
    "photography": {
      "dawn": {
        "light": ["photo/dawn/light-1.webp", "photo/dawn/light-2.webp", "photo/dawn/light-3.webp"],
        "moderate": ["photo/dawn/moderate-1.webp", "photo/dawn/moderate-2.webp", "photo/dawn/moderate-3.webp"],
        "packed": ["photo/dawn/packed-1.webp", "photo/dawn/packed-2.webp", "photo/dawn/packed-3.webp"]
      },
      "morning": {
        "light": ["photo/morning/light-1.webp", "photo/morning/light-2.webp", "photo/morning/light-3.webp"],
        "moderate": ["photo/morning/moderate-1.webp", "photo/morning/moderate-2.webp", "photo/morning/moderate-3.webp"],
        "packed": ["photo/morning/packed-1.webp", "photo/morning/packed-2.webp", "photo/morning/packed-3.webp"]
      },
      "afternoon": {
        "light": ["photo/afternoon/light-1.webp", "photo/afternoon/light-2.webp", "photo/afternoon/light-3.webp"],
        "moderate": ["photo/afternoon/moderate-1.webp", "photo/afternoon/moderate-2.webp", "photo/afternoon/moderate-3.webp"],
        "packed": ["photo/afternoon/packed-1.webp", "photo/afternoon/packed-2.webp", "photo/afternoon/packed-3.webp"]
      },
      "goldenHour": {
        "light": ["photo/golden-hour/light-1.webp", "photo/golden-hour/light-2.webp", "photo/golden-hour/light-3.webp"],
        "moderate": ["photo/golden-hour/moderate-1.webp", "photo/golden-hour/moderate-2.webp", "photo/golden-hour/moderate-3.webp"],
        "packed": ["photo/golden-hour/packed-1.webp", "photo/golden-hour/packed-2.webp", "photo/golden-hour/packed-3.webp"]
      },
      "evening": {
        "light": ["photo/evening/light-1.webp", "photo/evening/light-2.webp", "photo/evening/light-3.webp"],
        "moderate": ["photo/evening/moderate-1.webp", "photo/evening/moderate-2.webp", "photo/evening/moderate-3.webp"],
        "packed": ["photo/evening/packed-1.webp", "photo/evening/packed-2.webp", "photo/evening/packed-3.webp"]
      },
      "night": {
        "light": ["photo/night/light-1.webp", "photo/night/light-2.webp", "photo/night/light-3.webp"],
        "moderate": ["photo/night/moderate-1.webp", "photo/night/moderate-2.webp", "photo/night/moderate-3.webp"],
        "packed": ["photo/night/packed-1.webp", "photo/night/packed-2.webp", "photo/night/packed-3.webp"]
      }
    },
    "abstract": {
      "dawn": {
        "light": ["abstract/dawn/light-1.webp", "abstract/dawn/light-2.webp", "abstract/dawn/light-3.webp"],
        "moderate": ["abstract/dawn/moderate-1.webp", "abstract/dawn/moderate-2.webp", "abstract/dawn/moderate-3.webp"],
        "packed": ["abstract/dawn/packed-1.webp", "abstract/dawn/packed-2.webp", "abstract/dawn/packed-3.webp"]
      },
      "morning": {
        "light": ["abstract/morning/light-1.webp", "abstract/morning/light-2.webp", "abstract/morning/light-3.webp"],
        "moderate": ["abstract/morning/moderate-1.webp", "abstract/morning/moderate-2.webp", "abstract/morning/moderate-3.webp"],
        "packed": ["abstract/morning/packed-1.webp", "abstract/morning/packed-2.webp", "abstract/morning/packed-3.webp"]
      },
      "afternoon": {
        "light": ["abstract/afternoon/light-1.webp", "abstract/afternoon/light-2.webp", "abstract/afternoon/light-3.webp"],
        "moderate": ["abstract/afternoon/moderate-1.webp", "abstract/afternoon/moderate-2.webp", "abstract/afternoon/moderate-3.webp"],
        "packed": ["abstract/afternoon/packed-1.webp", "abstract/afternoon/packed-2.webp", "abstract/afternoon/packed-3.webp"]
      },
      "goldenHour": {
        "light": ["abstract/golden-hour/light-1.webp", "abstract/golden-hour/light-2.webp", "abstract/golden-hour/light-3.webp"],
        "moderate": ["abstract/golden-hour/moderate-1.webp", "abstract/golden-hour/moderate-2.webp", "abstract/golden-hour/moderate-3.webp"],
        "packed": ["abstract/golden-hour/packed-1.webp", "abstract/golden-hour/packed-2.webp", "abstract/golden-hour/packed-3.webp"]
      },
      "evening": {
        "light": ["abstract/evening/light-1.webp", "abstract/evening/light-2.webp", "abstract/evening/light-3.webp"],
        "moderate": ["abstract/evening/moderate-1.webp", "abstract/evening/moderate-2.webp", "abstract/evening/moderate-3.webp"],
        "packed": ["abstract/evening/packed-1.webp", "abstract/evening/packed-2.webp", "abstract/evening/packed-3.webp"]
      },
      "night": {
        "light": ["abstract/night/light-1.webp", "abstract/night/light-2.webp", "abstract/night/light-3.webp"],
        "moderate": ["abstract/night/moderate-1.webp", "abstract/night/moderate-2.webp", "abstract/night/moderate-3.webp"],
        "packed": ["abstract/night/packed-1.webp", "abstract/night/packed-2.webp", "abstract/night/packed-3.webp"]
      }
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/desktop/src/data/background-manifest.json
git commit -m "feat(background): add image manifest structure"
```

---

### Task 4: Prisma Migration + API Endpoint

**Files:**
- Modify: `apps/api/prisma/schema.prisma:34` (after `weatherEnabled`)
- Modify: `apps/api/src/routes/users.ts` (GET /users/me select + PATCH /users/location validation)

- [ ] **Step 1: Add `backgroundStyle` to User model**

In `apps/api/prisma/schema.prisma`, add after the `weatherEnabled` line (~line 34):

```prisma
  backgroundStyle String   @default("photography")
```

- [ ] **Step 2: Run the migration**

Run: `cd apps/api && pnpm prisma migrate dev --name add-background-style`
Expected: Migration created and applied successfully

- [ ] **Step 3: Add `backgroundStyle` to GET /users/me response**

In `apps/api/src/routes/users.ts`, find the `select` object in the `/me` GET handler and add `backgroundStyle: true`. Also add it to the response JSON.

Find the `select` block in the `findUnique` call (~line 20-30):
```typescript
select: {
  timezone: true,
  timezoneAuto: true,
  city: true,
  countryCode: true,
  latitude: true,
  longitude: true,
  tempUnit: true,
  weatherEnabled: true,
  backgroundStyle: true,  // ADD THIS
},
```

Find where the response is built and add:
```typescript
backgroundStyle: fullUser?.backgroundStyle ?? "photography",
```

- [ ] **Step 4: Add `backgroundStyle` to PATCH /users/location validation**

In `apps/api/src/routes/users.ts`, in the PATCH `/location` handler, add validation after the existing field validations:

```typescript
const backgroundStyle = body.backgroundStyle as string | undefined;
if (backgroundStyle !== undefined) {
  const validStyles = ["photography", "abstract"];
  if (!validStyles.includes(backgroundStyle)) {
    return c.json({ error: "backgroundStyle must be 'photography' or 'abstract'" }, 400);
  }
}
```

And in the `data` object construction:
```typescript
if (backgroundStyle !== undefined) data.backgroundStyle = backgroundStyle;
```

And in the `select` block of the update call, add `backgroundStyle: true`.

- [ ] **Step 5: Verify the API compiles**

Run: `cd apps/api && pnpm typecheck`
Expected: No type errors

- [ ] **Step 6: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations/ apps/api/src/routes/users.ts
git commit -m "feat(background): add backgroundStyle to User model and API"
```

---

### Task 5: useAppConfig Hook

**Files:**
- Create: `apps/desktop/src/hooks/useAppConfig.ts`

This hook fetches the `/config` endpoint and makes the storage base URL available app-wide. Currently this is only done in `LoginPage.tsx` via a local hook.

- [ ] **Step 1: Create the hook**

```typescript
// apps/desktop/src/hooks/useAppConfig.ts
import { useQuery } from "@tanstack/react-query";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001";

interface AppConfig {
  storageBaseUrl: string;
}

export function useAppConfig() {
  return useQuery({
    queryKey: ["app-config"],
    queryFn: async (): Promise<AppConfig> => {
      const res = await fetch(`${API_URL}/config`);
      const data = await res.json();
      return {
        storageBaseUrl: data.videoBaseUrl ?? "",
      };
    },
    staleTime: Infinity, // Config doesn't change during a session
    retry: 2,
  });
}
```

Note: This reuses the existing `/config` endpoint which returns `{ videoBaseUrl }`. We map it to `storageBaseUrl` on the client for clarity. No API changes needed.

- [ ] **Step 2: Verify it compiles**

Run: `pnpm typecheck`
Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/hooks/useAppConfig.ts
git commit -m "feat(background): add useAppConfig hook for storage base URL"
```

---

### Task 6: useBackground Hook

**Files:**
- Create: `apps/desktop/src/hooks/useBackground.ts`

This is the core hook that integrates time segment detection, busyness calculation, image selection, rotation timer, and crossfade state management.

- [ ] **Step 1: Create the hook**

```typescript
// apps/desktop/src/hooks/useBackground.ts
import { useState, useEffect, useCallback, useRef } from "react";
import {
  getTimeSegment,
  getBusynessTier,
  selectImage,
  type TimeSegment,
  type BusynessTier,
  type BackgroundStyle,
  type BackgroundManifest,
} from "@brett/business";
import manifest from "../data/background-manifest.json";
import { useAppConfig } from "./useAppConfig";
import fallbackBg from "../assets/fallback-bg.webp";

const ROTATION_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
const SEGMENT_CHECK_MS = 60 * 1000; // 60 seconds
const CROSSFADE_MS = 3000;
const PRELOAD_BEFORE_BOUNDARY_MS = 5 * 60 * 1000; // 5 minutes

interface UseBackgroundInput {
  meetingCount: number;
  taskCount: number;
  backgroundStyle: BackgroundStyle;
}

interface UseBackgroundOutput {
  imageUrl: string;
  nextImageUrl: string | null;
  isTransitioning: boolean;
  segment: TimeSegment;
  busynessTier: BusynessTier;
}

export function useBackground({
  meetingCount,
  taskCount,
  backgroundStyle,
}: UseBackgroundInput): UseBackgroundOutput {
  const { data: config } = useAppConfig();
  const baseUrl = config?.storageBaseUrl ?? "";

  // Current computed state
  const [segment, setSegment] = useState<TimeSegment>(() =>
    getTimeSegment(new Date().getHours())
  );
  const [busynessTier, setBusynessTier] = useState<BusynessTier>(() =>
    getBusynessTier(meetingCount, taskCount)
  );

  // Image state
  const [currentImage, setCurrentImage] = useState<string>(fallbackBg);
  const [nextImage, setNextImage] = useState<string | null>(null);
  const [isTransitioning, setIsTransitioning] = useState(false);

  // Track shown images for shuffle-without-replacement
  const shownRef = useRef<string[]>([]);
  // Track current category to detect changes
  const categoryRef = useRef({ segment, busynessTier, backgroundStyle });

  // Build full URL from relative path
  const buildUrl = useCallback(
    (relativePath: string) => `${baseUrl}/backgrounds/${relativePath}`,
    [baseUrl]
  );

  // Pick and load a new image, then crossfade to it
  const rotateImage = useCallback(() => {
    const seg = getTimeSegment(new Date().getHours());
    const tier = getBusynessTier(meetingCount, taskCount);

    // Reset shown list if category changed
    const cat = categoryRef.current;
    if (cat.segment !== seg || cat.busynessTier !== tier || cat.backgroundStyle !== backgroundStyle) {
      shownRef.current = [];
      categoryRef.current = { segment: seg, busynessTier: tier, backgroundStyle };
    }

    setSegment(seg);
    setBusynessTier(tier);

    const relativePath = selectImage(
      manifest as BackgroundManifest,
      backgroundStyle,
      seg,
      tier,
      shownRef.current
    );

    if (!relativePath || !baseUrl) return;

    const fullUrl = buildUrl(relativePath);
    shownRef.current.push(relativePath);

    // Preload, then crossfade
    const img = new Image();
    img.onload = () => {
      setNextImage(fullUrl);
      setIsTransitioning(true);

      setTimeout(() => {
        setCurrentImage(fullUrl);
        setNextImage(null);
        setIsTransitioning(false);
      }, CROSSFADE_MS);
    };
    img.onerror = () => {
      // Silently fail — stay on current image, retry next rotation
    };
    img.src = fullUrl;
  }, [meetingCount, taskCount, backgroundStyle, baseUrl, buildUrl]);

  // Initial image load when config becomes available
  useEffect(() => {
    if (baseUrl) {
      rotateImage();
    }
  }, [baseUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  // Rotation timer
  useEffect(() => {
    const interval = setInterval(rotateImage, ROTATION_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [rotateImage]);

  // Segment check timer (60s) + visibility change listener
  useEffect(() => {
    const checkSegment = () => {
      const newSegment = getTimeSegment(new Date().getHours());
      if (newSegment !== categoryRef.current.segment) {
        rotateImage();
      }
    };

    const interval = setInterval(checkSegment, SEGMENT_CHECK_MS);

    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        checkSegment();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [rotateImage]);

  // Recalculate busyness when inputs change (next rotation picks new tier)
  useEffect(() => {
    const newTier = getBusynessTier(meetingCount, taskCount);
    setBusynessTier(newTier);
  }, [meetingCount, taskCount]);

  // Immediately rotate when user switches background style (photo ↔ abstract)
  const prevStyleRef = useRef(backgroundStyle);
  useEffect(() => {
    if (prevStyleRef.current !== backgroundStyle && baseUrl) {
      prevStyleRef.current = backgroundStyle;
      rotateImage();
    }
  }, [backgroundStyle, baseUrl, rotateImage]);

  // Preload next segment's image 5 minutes before boundary
  useEffect(() => {
    const preloadCheck = () => {
      const now = new Date();
      const currentHour = now.getHours();
      const minutesIntoHour = now.getMinutes();
      const currentSeg = getTimeSegment(currentHour);

      // Check if we're within 5 minutes of the next segment boundary
      const segmentBoundaries: Record<string, number> = {
        night: 5, dawn: 7, morning: 12, afternoon: 17, goldenHour: 19, evening: 21,
      };
      const nextBoundaryHour = segmentBoundaries[currentSeg];
      if (nextBoundaryHour === undefined) return;

      const minutesUntilBoundary =
        currentHour === nextBoundaryHour - 1
          ? 60 - minutesIntoHour
          : (nextBoundaryHour - currentHour - 1) * 60 + (60 - minutesIntoHour);

      if (minutesUntilBoundary <= 5 && minutesUntilBoundary > 0) {
        const nextSeg = getTimeSegment(nextBoundaryHour);
        const tier = getBusynessTier(meetingCount, taskCount);
        const path = selectImage(manifest as BackgroundManifest, backgroundStyle, nextSeg, tier, []);
        if (path && baseUrl) {
          const img = new Image();
          img.src = buildUrl(path);
        }
      }
    };

    // Run preload check on the same 60s interval
    const interval = setInterval(preloadCheck, SEGMENT_CHECK_MS);
    return () => clearInterval(interval);
  }, [meetingCount, taskCount, backgroundStyle, baseUrl, buildUrl]);

  return {
    imageUrl: currentImage,
    nextImageUrl: nextImage,
    isTransitioning,
    segment,
    busynessTier,
  };
}
```

- [ ] **Step 2: Verify it compiles**

Run: `pnpm typecheck`
Expected: May fail on missing `fallback-bg.webp` asset — that's OK, we'll add it in Task 8. If it fails on the import, add a temporary placeholder or a type declaration. Focus on logic correctness.

If Vite asset import types are missing, add to `apps/desktop/src/vite-env.d.ts` (or create it):
```typescript
declare module "*.webp" {
  const src: string;
  export default src;
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/hooks/useBackground.ts apps/desktop/src/vite-env.d.ts
git commit -m "feat(background): add useBackground hook with rotation and crossfade logic"
```

---

### Task 7: LivingBackground Component

**Files:**
- Create: `packages/ui/src/LivingBackground.tsx`

- [ ] **Step 1: Create the component**

```tsx
// packages/ui/src/LivingBackground.tsx

interface LivingBackgroundProps {
  imageUrl: string;
  nextImageUrl: string | null;
  isTransitioning: boolean;
}

export function LivingBackground({
  imageUrl,
  nextImageUrl,
  isTransitioning,
}: LivingBackgroundProps) {
  return (
    <div className="absolute inset-0 z-0">
      {/* Image layer A — current */}
      <img
        src={imageUrl}
        alt=""
        className="absolute inset-0 w-full h-full object-cover transition-opacity duration-[3000ms]"
        style={{ opacity: isTransitioning ? 0 : 1 }}
        draggable={false}
      />

      {/* Image layer B — next (crossfade target) */}
      {nextImageUrl && (
        <img
          src={nextImageUrl}
          alt=""
          className="absolute inset-0 w-full h-full object-cover transition-opacity duration-[3000ms]"
          style={{ opacity: isTransitioning ? 1 : 0 }}
          draggable={false}
        />
      )}

      {/* Vignette overlay for readability */}
      <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-transparent to-black/60 pointer-events-none" />

      {/* Left-side scrim for nav readability */}
      <div className="absolute inset-y-0 left-0 w-[312px] bg-gradient-to-r from-black/60 to-transparent pointer-events-none" />
    </div>
  );
}
```

- [ ] **Step 2: Export from @brett/ui barrel**

Find the barrel export file for `@brett/ui` (`packages/ui/src/index.ts` or `packages/ui/src/index.tsx`). Add:

```typescript
export { LivingBackground } from "./LivingBackground";
```

This must happen before Task 8, which imports `LivingBackground` from `@brett/ui` in App.tsx.

- [ ] **Step 3: Verify it compiles**

Run: `pnpm typecheck`
Expected: No type errors

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/LivingBackground.tsx packages/ui/src/index.ts
git commit -m "feat(background): add LivingBackground crossfade component"
```

---

### Task 8: Fallback Image + Integration in App.tsx

**Files:**
- Create: `apps/desktop/src/assets/fallback-bg.webp`
- Modify: `apps/desktop/src/App.tsx:811-828`

- [ ] **Step 1: Add a fallback background image**

Source a dark, neutral landscape image (e.g., a dark mountain silhouette or night sky). Convert to WebP at 1920×1080, ~200KB. Place at `apps/desktop/src/assets/fallback-bg.webp`.

For development, you can use any dark landscape photo. Convert with:
```bash
# Example if you have a source image
cwebp -q 80 -resize 1920 1080 source.jpg -o apps/desktop/src/assets/fallback-bg.webp
```

Or download a placeholder and convert. The important thing is having a valid `.webp` file at this path so imports resolve.

- [ ] **Step 2: Wire up useBackground in App.tsx**

In `apps/desktop/src/App.tsx`, add the imports near the top of the file (with existing imports):

```typescript
import { useBackground } from "./hooks/useBackground";
import { LivingBackground } from "@brett/ui";
import type { BackgroundStyle } from "@brett/business";
```

Inside the main `App` component (or the component that renders the background — look for where `todayCalendarEvents` and `activeThingsForCount` are in scope), compute the busyness inputs and call the hook:

```typescript
// Compute today's task count — tasks due today or overdue, using timezone-aware bounds
// This uses getUserDayBounds (from @brett/business) rather than the existing "this week" query
// to avoid inflating the busyness score. Import getUserDayBounds if not already imported.
const todayTaskCount = useMemo(() => {
  if (!activeThingsForCount) return 0;
  // Use the same timezone-aware day bounds already computed in App (todayBounds)
  // todayBounds = { startDate: ISO, endDate: ISO } from localDayBounds(new Date())
  const endOfToday = new Date(todayBounds.endDate);
  return activeThingsForCount.filter((t: any) => {
    if (!t.dueDate) return false;
    return new Date(t.dueDate) <= endOfToday;
  }).length;
}, [activeThingsForCount, todayBounds]);

// Meeting count from today's calendar events
const todayMeetingCount = todayCalendarEvents?.length ?? 0;

// Background style from user preferences (fetched via useQuery ["user-me"])
// Add backgroundStyle to the user-me query response consumption
const backgroundStyle: BackgroundStyle = (userMe?.backgroundStyle as BackgroundStyle) ?? "photography";

const background = useBackground({
  meetingCount: todayMeetingCount,
  taskCount: todayTaskCount,
  backgroundStyle,
});
```

- [ ] **Step 3: Replace the hardcoded background divs**

Find and remove the three existing background divs (lines ~811-825 in App.tsx):

```tsx
{/* REMOVE THESE THREE DIVS: */}
{/* Full-bleed Photographic Background */}
<div className="absolute inset-0 z-0 bg-cover bg-center opacity-80" style={{...}} />
{/* Vignette overlay */}
<div className="absolute inset-0 z-0 bg-gradient-to-b ..." />
{/* Left-side scrim */}
<div className="absolute inset-y-0 left-0 w-[312px] z-0 ..." />
```

Replace with:

```tsx
<LivingBackground
  imageUrl={background.imageUrl}
  nextImageUrl={background.nextImageUrl}
  isTransitioning={background.isTransitioning}
/>
```

- [ ] **Step 4: Verify it compiles and renders**

Run: `pnpm typecheck`
Then: `pnpm dev:desktop` and visually verify the fallback image shows on launch.

Expected: App renders with the fallback image. No runtime errors. Once actual images are uploaded to Railway storage, the dynamic images will load and crossfade.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/assets/fallback-bg.webp apps/desktop/src/App.tsx
git commit -m "feat(background): integrate LivingBackground into App.tsx"
```

---

### Task 9: Settings UI — Background Section

**Files:**
- Create: `apps/desktop/src/settings/BackgroundSection.tsx`
- Modify: `apps/desktop/src/settings/SettingsPage.tsx`

- [ ] **Step 1: Add `backgroundStyle` to LocationSettings type**

In `apps/desktop/src/api/location.ts`, find the `LocationSettings` interface (or the type used by the mutation). Add:

```typescript
interface LocationSettings {
  // ... existing fields ...
  backgroundStyle?: "photography" | "abstract";
}
```

This must happen before Step 2 to avoid `as any` casts.

- [ ] **Step 2: Create the BackgroundSection component**

Follow the pattern from `LocationSection.tsx` — fetch user data, local state, mutation on change.

```tsx
// apps/desktop/src/settings/BackgroundSection.tsx
import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../api/client";
import { useLocationSettings } from "../api/location";
import { Image, Sparkles } from "lucide-react";

export function BackgroundSection() {
  const { data: user } = useQuery({
    queryKey: ["user-me"],
    queryFn: () => apiFetch<{ backgroundStyle: string }>("/users/me"),
  });
  const { updateLocation, isSaving } = useLocationSettings();
  const [style, setStyle] = useState<"photography" | "abstract">("photography");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (user?.backgroundStyle) {
      setStyle(user.backgroundStyle as "photography" | "abstract");
    }
  }, [user]);

  async function handleChange(newStyle: "photography" | "abstract") {
    setStyle(newStyle);
    try {
      await updateLocation({ backgroundStyle: newStyle });
      setError(null);
    } catch {
      setError("Failed to save. Try again.");
      setTimeout(() => setError(null), 4000);
    }
  }

  return (
    <div className="bg-black/30 backdrop-blur-xl rounded-xl border border-white/10 p-6">
      <h3 className="font-mono text-[11px] uppercase tracking-wider text-white/40 font-semibold mb-4">
        Background
      </h3>

      {error && <p className="text-xs text-red-400/80 mb-3">{error}</p>}

      <div className="flex gap-3">
        <button
          onClick={() => handleChange("photography")}
          disabled={isSaving}
          className={`flex-1 flex items-center gap-3 p-4 rounded-lg border transition-all duration-200 ${
            style === "photography"
              ? "bg-blue-500/10 border-blue-500/30 text-white"
              : "bg-white/5 border-white/10 text-white/50 hover:bg-white/10 hover:text-white/80"
          }`}
        >
          <Image size={18} />
          <div className="text-left">
            <div className="text-sm font-medium">Photography</div>
            <div className="text-xs text-white/40 mt-0.5">Landscapes that shift with your day</div>
          </div>
        </button>

        <button
          onClick={() => handleChange("abstract")}
          disabled={isSaving}
          className={`flex-1 flex items-center gap-3 p-4 rounded-lg border transition-all duration-200 ${
            style === "abstract"
              ? "bg-blue-500/10 border-blue-500/30 text-white"
              : "bg-white/5 border-white/10 text-white/50 hover:bg-white/10 hover:text-white/80"
          }`}
        >
          <Sparkles size={18} />
          <div className="text-left">
            <div className="text-sm font-medium">Abstract</div>
            <div className="text-xs text-white/40 mt-0.5">Gradients and shapes</div>
          </div>
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add BackgroundSection to SettingsPage**

In `apps/desktop/src/settings/SettingsPage.tsx`, find the Preferences tab content (the `<div id="preferences">` section). Add `<BackgroundSection />` after `<LocationSection />`.

Add the import:
```typescript
import { BackgroundSection } from "./BackgroundSection";
```

Add in the preferences section:
```tsx
<div id="preferences">
  <div className="space-y-5">
    <TimezoneSection />
    <LocationSection />
    <BackgroundSection />
    <BriefingSection />
  </div>
</div>
```

- [ ] **Step 5: Verify it compiles and renders**

Run: `pnpm typecheck`
Then: `pnpm dev:desktop`, navigate to Settings → Preferences, verify the Background section appears with two toggle buttons.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/settings/BackgroundSection.tsx apps/desktop/src/settings/SettingsPage.tsx apps/desktop/src/api/location.ts
git commit -m "feat(background): add background style toggle to settings"
```

---

### Task 10: Typecheck + Smoke Test

**Files:** None (verification only)

- [ ] **Step 1: Full typecheck**

Run: `pnpm typecheck`
Expected: No type errors across all packages

- [ ] **Step 2: Run existing tests**

Run: `pnpm test`
Expected: All existing tests still pass

- [ ] **Step 3: Run background-specific tests**

Run: `cd packages/business && pnpm vitest run src/__tests__/background.test.ts`
Expected: All background tests pass

- [ ] **Step 4: Visual smoke test**

Run: `pnpm dev:desktop`

Verify:
1. App launches with fallback image (or dynamic image if storage is configured)
2. Vignette and left scrim overlays are visible
3. Glass cards are readable over the background
4. Settings → Preferences shows Background section
5. Toggling photography ↔ abstract saves without error
6. No console errors

- [ ] **Step 5: Final commit (if any fixes needed)**

```bash
git add -A
git commit -m "fix(background): address typecheck and smoke test issues"
```

---

## Post-Implementation

### Image Curation & Upload (Manual Task)

Not part of the code implementation. This is a design task:

1. Source 54 photography images (18 categories × 3 each) matching the mood mapping in the spec
2. Source 54 abstract images (same structure)
3. Convert all to WebP at 1920×1080, ~150-300KB each
4. Upload to Railway Object Storage under `backgrounds/` prefix, matching the manifest paths
5. Test each image behind the app's glass surfaces for readability
6. Replace the fallback image with one of the best night/neutral images

### Code Review

After implementation, run the code reviewer agent against the spec to verify all requirements are met.
