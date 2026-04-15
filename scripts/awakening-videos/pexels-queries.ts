// scripts/awakening-videos/pexels-queries.ts

export const SEGMENTS = ["dawn", "morning", "afternoon", "goldenHour", "evening", "night"] as const;
export type Segment = typeof SEGMENTS[number];

export const QUERY_BY_SEGMENT: Record<Segment, string> = {
  dawn:       "misty lake dawn slow motion",
  morning:    "alpine morning sunlight ambient slow",
  afternoon:  "desert afternoon clouds slow motion",
  goldenHour: "ocean waves sunset golden hour ambient",
  evening:    "twilight clouds slow motion ambient",
  night:      "starry night sky slow motion ambient",
};
