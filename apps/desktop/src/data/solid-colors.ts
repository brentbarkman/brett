/**
 * Solid background colors matching macOS Sequoia's wallpaper palette.
 * Just the color. No fake lighting tricks.
 */
export interface SolidColor {
  id: string;
  label: string;
  color: string;
}

export const solidColors: SolidColor[] = [
  { id: "stone", label: "Stone", color: "#636366" },
  { id: "space-gray", label: "Space Gray", color: "#48484a" },
  { id: "graphite", label: "Graphite", color: "#2c2c2e" },
  { id: "black", label: "Black", color: "#1c1c1e" },
  { id: "blue", label: "Blue", color: "#0040dd" },
  { id: "indigo", label: "Indigo", color: "#3634a3" },
  { id: "purple", label: "Purple", color: "#8944ab" },
  { id: "pink", label: "Pink", color: "#d63384" },
  { id: "red", label: "Red", color: "#c41e3a" },
  { id: "orange", label: "Orange", color: "#c45800" },
  { id: "yellow", label: "Yellow", color: "#9e7700" },
  { id: "green", label: "Green", color: "#248a3d" },
  { id: "mint", label: "Mint", color: "#0db39e" },
  { id: "cyan", label: "Cyan", color: "#0077c8" },
  { id: "dark-blue", label: "Dark Blue", color: "#1a237e" },
  { id: "dark-green", label: "Dark Green", color: "#1b5e20" },
];
