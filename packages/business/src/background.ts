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

export function getBusynessTier(meetingCount: number, taskCount: number): BusynessTier {
  const score = meetingCount * 2 + taskCount;
  if (score <= 4) return "light";
  if (score <= 10) return "moderate";
  return "packed";
}
