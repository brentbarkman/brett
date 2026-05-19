import type { TriageDatePreset } from "@brett/business";

export const DATE_LETTER_TO_PRESET: Record<string, TriageDatePreset> = {
  t: "today",
  // 'e' for evening — 'n' was the obvious pick but is already next_week;
  // 't' / 'm' are taken by today/tomorrow; 'i' / 'g' from "tonight" read
  // less naturally as a shortcut hint.
  e: "tonight",
  m: "tomorrow",
  s: "this_weekend",
  w: "this_week",
  n: "next_week",
  x: "next_month",
};

export const DATE_PRESET_ORDER: TriageDatePreset[] = [
  "today",
  "tonight",
  "tomorrow",
  "this_weekend",
  "this_week",
  "next_week",
  "next_month",
];

export const DATE_PRESET_LABELS: Record<TriageDatePreset, string> = {
  today: "Today",
  tonight: "Tonight",
  tomorrow: "Tomorrow",
  this_weekend: "This Weekend",
  this_week: "This Week",
  next_week: "Next Week",
  next_month: "Next Month",
};

export const DATE_PRESET_TO_LETTER: Record<TriageDatePreset, string> =
  Object.fromEntries(
    Object.entries(DATE_LETTER_TO_PRESET).map(([letter, preset]) => [
      preset,
      letter,
    ]),
  ) as Record<TriageDatePreset, string>;
