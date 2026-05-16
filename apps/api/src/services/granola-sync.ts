// Working hours gate: 8am-7pm in user's timezone.
// Used by the periodic meeting-notes sweep cron to avoid pinging Granola for
// users who are off-hours.
const WORKING_HOURS_START = 8;
const WORKING_HOURS_END = 19;

export function isWithinWorkingHours(timezone: string): boolean {
  try {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      hour12: false,
    });
    const hour = parseInt(formatter.format(now), 10);
    return hour >= WORKING_HOURS_START && hour < WORKING_HOURS_END;
  } catch {
    return true; // Fallback: assume working hours
  }
}
