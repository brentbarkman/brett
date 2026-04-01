/**
 * Curated solid background colors — inspired by macOS Sequoia.
 * Richer mid-dark tones, not extreme darks. Each has subtle radial
 * depth (lighter center, darker edges) for a lit-surface feel.
 */
export interface SolidColor {
  id: string;
  label: string;
  /** Base color (used for the swatch preview circle) */
  color: string;
  /** CSS background with subtle radial depth */
  background: string;
}

function solidWithDepth(base: string, highlight: string): string {
  return `
    radial-gradient(ellipse at 50% 40%, ${highlight} 0%, transparent 70%),
    radial-gradient(ellipse at 50% 100%, rgba(0,0,0,0.4) 0%, transparent 70%),
    ${base}
  `;
}

export const solidColors: SolidColor[] = [
  {
    id: "black", label: "Black", color: "#1d1d1f",
    background: solidWithDepth("#1d1d1f", "rgba(50,50,52,0.5)"),
  },
  {
    id: "blue", label: "Blue", color: "#1c3a5f",
    background: solidWithDepth("#1c3a5f", "rgba(40,80,140,0.5)"),
  },
  {
    id: "indigo", label: "Indigo", color: "#2e1a6b",
    background: solidWithDepth("#2e1a6b", "rgba(65,40,140,0.5)"),
  },
  {
    id: "purple", label: "Purple", color: "#452170",
    background: solidWithDepth("#452170", "rgba(90,50,145,0.5)"),
  },
  {
    id: "pink", label: "Pink", color: "#5c1a3e",
    background: solidWithDepth("#5c1a3e", "rgba(120,40,80,0.5)"),
  },
  {
    id: "red", label: "Red", color: "#5c1a1a",
    background: solidWithDepth("#5c1a1a", "rgba(120,40,40,0.5)"),
  },
  {
    id: "orange", label: "Orange", color: "#5c2e0e",
    background: solidWithDepth("#5c2e0e", "rgba(120,65,25,0.5)"),
  },
  {
    id: "yellow", label: "Yellow", color: "#4a3a0a",
    background: solidWithDepth("#4a3a0a", "rgba(100,80,20,0.5)"),
  },
  {
    id: "green", label: "Green", color: "#1a3d20",
    background: solidWithDepth("#1a3d20", "rgba(40,85,45,0.5)"),
  },
  {
    id: "teal", label: "Teal", color: "#0f3d3d",
    background: solidWithDepth("#0f3d3d", "rgba(25,85,85,0.5)"),
  },
  {
    id: "grey", label: "Grey", color: "#2c2c2e",
    background: solidWithDepth("#2c2c2e", "rgba(65,65,68,0.5)"),
  },
  {
    id: "warmgrey", label: "Warm Grey", color: "#33302a",
    background: solidWithDepth("#33302a", "rgba(70,65,55,0.5)"),
  },
];
