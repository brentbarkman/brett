import type { CalendarGlassColor } from "@brett/types";
import { googleColorToGlass, GOOGLE_DEFAULT_COLOR_HEX } from "@brett/utils";

export { googleColorToGlass };

interface ColorMap {
  event: Record<string, { background?: string | null }>;
  calendar: Record<string, { background?: string | null }>;
}

/** Get glass color for a calendar event, falling back through event color -> calendar color -> default */
export function getGlassColorForEvent(
  eventColorId: string | null | undefined,
  calendarColorId: string | null | undefined,
  colorMap: ColorMap,
): CalendarGlassColor {
  if (eventColorId && colorMap.event[eventColorId]?.background) {
    return googleColorToGlass(colorMap.event[eventColorId].background!);
  }

  if (calendarColorId && colorMap.calendar[calendarColorId]?.background) {
    return googleColorToGlass(colorMap.calendar[calendarColorId].background!);
  }

  return googleColorToGlass(GOOGLE_DEFAULT_COLOR_HEX);
}
