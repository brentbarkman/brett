/**
 * Solid background colors matching macOS Sequoia's wallpaper palette.
 * Each has subtle radial depth (lighter center, darker edges).
 */
export interface SolidColor {
  id: string;
  label: string;
  color: string;
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
    id: "stone", label: "Stone", color: "#636366",
    background: solidWithDepth("#636366", "rgba(130,130,135,0.5)"),
  },
  {
    id: "space-gray", label: "Space Gray", color: "#48484a",
    background: solidWithDepth("#48484a", "rgba(95,95,98,0.5)"),
  },
  {
    id: "graphite", label: "Graphite", color: "#2c2c2e",
    background: solidWithDepth("#2c2c2e", "rgba(65,65,68,0.5)"),
  },
  {
    id: "black", label: "Black", color: "#1c1c1e",
    background: solidWithDepth("#1c1c1e", "rgba(45,45,48,0.4)"),
  },
  {
    id: "blue", label: "Blue", color: "#0040dd",
    background: solidWithDepth("#0040dd", "rgba(30,90,235,0.5)"),
  },
  {
    id: "indigo", label: "Indigo", color: "#3634a3",
    background: solidWithDepth("#3634a3", "rgba(75,72,195,0.5)"),
  },
  {
    id: "purple", label: "Purple", color: "#8944ab",
    background: solidWithDepth("#8944ab", "rgba(160,85,200,0.5)"),
  },
  {
    id: "pink", label: "Pink", color: "#d63384",
    background: solidWithDepth("#d63384", "rgba(230,70,155,0.5)"),
  },
  {
    id: "red", label: "Red", color: "#c41e3a",
    background: solidWithDepth("#c41e3a", "rgba(215,50,80,0.5)"),
  },
  {
    id: "orange", label: "Orange", color: "#c45800",
    background: solidWithDepth("#c45800", "rgba(215,110,20,0.5)"),
  },
  {
    id: "yellow", label: "Yellow", color: "#9e7700",
    background: solidWithDepth("#9e7700", "rgba(180,140,20,0.5)"),
  },
  {
    id: "green", label: "Green", color: "#248a3d",
    background: solidWithDepth("#248a3d", "rgba(55,165,80,0.5)"),
  },
  {
    id: "mint", label: "Mint", color: "#0db39e",
    background: solidWithDepth("#0db39e", "rgba(30,200,178,0.5)"),
  },
  {
    id: "cyan", label: "Cyan", color: "#0077c8",
    background: solidWithDepth("#0077c8", "rgba(20,140,220,0.5)"),
  },
  {
    id: "dark-blue", label: "Dark Blue", color: "#1a237e",
    background: solidWithDepth("#1a237e", "rgba(40,55,155,0.5)"),
  },
  {
    id: "dark-green", label: "Dark Green", color: "#1b5e20",
    background: solidWithDepth("#1b5e20", "rgba(45,120,50,0.5)"),
  },
];
