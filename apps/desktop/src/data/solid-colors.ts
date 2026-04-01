/**
 * Curated solid background colors.
 * All dark enough to work with glass surfaces and white text.
 */
export interface SolidColor {
  id: string;
  label: string;
  color: string;
}

export const solidColors: SolidColor[] = [
  { id: "charcoal", label: "Charcoal", color: "#1a1a1a" },
  { id: "midnight", label: "Midnight", color: "#0f1729" },
  { id: "navy", label: "Deep Navy", color: "#0c1445" },
  { id: "indigo", label: "Indigo", color: "#1e1145" },
  { id: "plum", label: "Plum", color: "#2d1530" },
  { id: "emerald", label: "Dark Emerald", color: "#0a2520" },
  { id: "forest", label: "Forest", color: "#121f1a" },
  { id: "slate", label: "Slate", color: "#1e2028" },
  { id: "espresso", label: "Espresso", color: "#1c1410" },
  { id: "obsidian", label: "Obsidian", color: "#0e0e0e" },
  { id: "storm", label: "Storm", color: "#151c2a" },
  { id: "wine", label: "Wine", color: "#2a1018" },
];
