/**
 * Curated solid background colors.
 * Each "solid" is actually a subtle radial gradient — lighter center,
 * darker edges — so it has depth and feels like a lit surface rather
 * than a flat hex code. Apple's "solid" wallpapers do this.
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
    id: "graphite", label: "Graphite", color: "#1c1c1e",
    background: solidWithDepth("#1c1c1e", "rgba(60,60,65,0.5)"),
  },
  {
    id: "midnight", label: "Midnight", color: "#0d1b2a",
    background: solidWithDepth("#0d1b2a", "rgba(25,50,75,0.5)"),
  },
  {
    id: "ocean", label: "Ocean", color: "#0a2463",
    background: solidWithDepth("#0a2463", "rgba(20,55,130,0.5)"),
  },
  {
    id: "indigo", label: "Indigo", color: "#2b1055",
    background: solidWithDepth("#2b1055", "rgba(65,30,115,0.5)"),
  },
  {
    id: "berry", label: "Berry", color: "#3b0764",
    background: solidWithDepth("#3b0764", "rgba(80,20,130,0.5)"),
  },
  {
    id: "wine", label: "Wine", color: "#4a0e2e",
    background: solidWithDepth("#4a0e2e", "rgba(100,25,60,0.5)"),
  },
  {
    id: "ember", label: "Ember", color: "#451a03",
    background: solidWithDepth("#451a03", "rgba(100,45,10,0.5)"),
  },
  {
    id: "forest", label: "Forest", color: "#052e16",
    background: solidWithDepth("#052e16", "rgba(15,75,40,0.5)"),
  },
  {
    id: "teal", label: "Teal", color: "#042f2e",
    background: solidWithDepth("#042f2e", "rgba(12,80,75,0.5)"),
  },
  {
    id: "slate", label: "Slate", color: "#1e293b",
    background: solidWithDepth("#1e293b", "rgba(50,65,85,0.5)"),
  },
  {
    id: "storm", label: "Storm", color: "#172554",
    background: solidWithDepth("#172554", "rgba(35,55,115,0.5)"),
  },
  {
    id: "void", label: "Void", color: "#09090b",
    background: solidWithDepth("#09090b", "rgba(25,25,30,0.4)"),
  },
];
