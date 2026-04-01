/**
 * Curated solid background colors.
 * Dark enough for glass surfaces and white text, but saturated enough
 * to actually SEE and distinguish. Not muddy near-black — actual color.
 */
export interface SolidColor {
  id: string;
  label: string;
  color: string;
}

export const solidColors: SolidColor[] = [
  { id: "graphite", label: "Graphite", color: "#1c1c1e" },
  { id: "midnight", label: "Midnight", color: "#0d1b2a" },
  { id: "ocean", label: "Ocean", color: "#0a2463" },
  { id: "indigo", label: "Indigo", color: "#2b1055" },
  { id: "berry", label: "Berry", color: "#3b0764" },
  { id: "wine", label: "Wine", color: "#4a0e2e" },
  { id: "ember", label: "Ember", color: "#451a03" },
  { id: "forest", label: "Forest", color: "#052e16" },
  { id: "teal", label: "Teal", color: "#042f2e" },
  { id: "slate", label: "Slate", color: "#1e293b" },
  { id: "storm", label: "Storm", color: "#172554" },
  { id: "void", label: "Void", color: "#09090b" },
];
