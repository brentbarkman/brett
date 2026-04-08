export const colors = {
  // Backgrounds
  background: "#000000",

  // Brand
  gold: "#E8B931",
  cerulean: "#4682C3",
  teal: "#48BBA0",
  red: "#E6554B",

  // Glass surfaces (rgba black at various opacities)
  glass: {
    subtle: "rgba(0, 0, 0, 0.30)",
    soft: "rgba(0, 0, 0, 0.45)",
    base: "rgba(0, 0, 0, 0.60)",
    strong: "rgba(0, 0, 0, 0.75)",
    heavy: "rgba(0, 0, 0, 0.85)",
  },

  // Text (white at various opacities)
  text: {
    primary: "rgba(255, 255, 255, 0.85)",
    secondary: "rgba(255, 255, 255, 0.40)",
    tertiary: "rgba(255, 255, 255, 0.25)",
    quaternary: "rgba(255, 255, 255, 0.15)",
  },

  // Borders (white at various opacities)
  border: {
    subtle: "rgba(255, 255, 255, 0.06)",
    soft: "rgba(255, 255, 255, 0.10)",
    base: "rgba(255, 255, 255, 0.15)",
    strong: "rgba(255, 255, 255, 0.25)",
  },
} as const;

export const typography = {
  pageHeader: {
    fontSize: 22,
    fontWeight: "700" as const,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "600" as const,
  },
  sectionLabel: {
    fontSize: 10,
    fontWeight: "600" as const,
    textTransform: "uppercase" as const,
    letterSpacing: 1.5,
  },
  taskTitle: {
    fontSize: 15,
    fontWeight: "500" as const,
  },
  body: {
    fontSize: 14,
    fontWeight: "400" as const,
  },
  metadata: {
    fontSize: 12,
    fontWeight: "400" as const,
  },
  caption: {
    fontSize: 11,
    fontWeight: "400" as const,
  },
  tabLabel: {
    fontSize: 10,
    fontWeight: "500" as const,
  },
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
} as const;

export const radii = {
  card: 14,
  taskRow: 11,
  button: 8,
  omnibar: 12,
  full: 9999,
} as const;

export const touchTargetMin = 44;
