import type { TimeSegment, BusynessTier } from "@brett/business";

/**
 * CSS gradient definitions for the abstract background set.
 *
 * Design principle: macOS Sonoma energy. Bold, saturated, VISIBLE.
 * Each gradient should be immediately distinguishable from its neighbors.
 * The glass surfaces (bg-black/40 backdrop-blur-xl) provide readability —
 * the gradients don't need to be dark to work.
 */

export interface GradientDef {
  background: string;
}

type GradientMap = Record<TimeSegment, Record<BusynessTier, GradientDef[]>>;

export const gradients: GradientMap = {
  // DAWN (5-7am) — lavender, rose, soft peach. Quiet but colorful.
  dawn: {
    light: [
      {
        background: `
          radial-gradient(ellipse at 20% 50%, rgba(167,139,250,0.7) 0%, transparent 50%),
          radial-gradient(ellipse at 80% 20%, rgba(251,113,133,0.5) 0%, transparent 40%),
          radial-gradient(ellipse at 60% 80%, rgba(196,181,253,0.4) 0%, transparent 50%),
          linear-gradient(135deg, #1a1035 0%, #2d1b4e 50%, #1e1040 100%)
        `,
      },
      {
        background: `
          radial-gradient(ellipse at 70% 40%, rgba(192,132,252,0.6) 0%, transparent 45%),
          radial-gradient(ellipse at 15% 70%, rgba(253,164,175,0.5) 0%, transparent 45%),
          radial-gradient(ellipse at 50% 10%, rgba(167,139,250,0.3) 0%, transparent 40%),
          linear-gradient(160deg, #1e1240 0%, #2a1845 50%, #1a0e38 100%)
        `,
      },
      {
        background: `
          radial-gradient(ellipse at 40% 30%, rgba(221,214,254,0.6) 0%, transparent 45%),
          radial-gradient(ellipse at 85% 65%, rgba(251,146,172,0.5) 0%, transparent 40%),
          radial-gradient(ellipse at 20% 80%, rgba(139,92,246,0.4) 0%, transparent 50%),
          linear-gradient(145deg, #1c1038 0%, #281845 40%, #1a0e35 100%)
        `,
      },
    ],
    moderate: [
      {
        background: `
          radial-gradient(ellipse at 30% 40%, rgba(139,92,246,0.8) 0%, transparent 40%),
          radial-gradient(ellipse at 75% 25%, rgba(244,114,182,0.6) 0%, transparent 38%),
          radial-gradient(ellipse at 55% 75%, rgba(167,139,250,0.5) 0%, transparent 45%),
          linear-gradient(135deg, #1a0e35 0%, #2e1855 50%, #1c1040 100%)
        `,
      },
      {
        background: `
          radial-gradient(ellipse at 60% 35%, rgba(168,85,247,0.75) 0%, transparent 38%),
          radial-gradient(ellipse at 20% 60%, rgba(251,113,133,0.55) 0%, transparent 40%),
          radial-gradient(ellipse at 80% 70%, rgba(192,132,252,0.45) 0%, transparent 42%),
          linear-gradient(150deg, #1e1040 0%, #301a58 45%, #1a0e38 100%)
        `,
      },
      {
        background: `
          radial-gradient(ellipse at 50% 50%, rgba(139,92,246,0.75) 0%, transparent 38%),
          radial-gradient(ellipse at 15% 25%, rgba(253,164,175,0.55) 0%, transparent 40%),
          radial-gradient(ellipse at 85% 75%, rgba(167,139,250,0.5) 0%, transparent 40%),
          linear-gradient(140deg, #1c0e38 0%, #2c1850 50%, #1a0e35 100%)
        `,
      },
    ],
    packed: [
      {
        background: `
          radial-gradient(ellipse at 35% 35%, rgba(126,34,206,0.85) 0%, transparent 35%),
          radial-gradient(ellipse at 70% 20%, rgba(236,72,153,0.7) 0%, transparent 32%),
          radial-gradient(ellipse at 50% 70%, rgba(139,92,246,0.6) 0%, transparent 38%),
          linear-gradient(135deg, #180a30 0%, #30185a 50%, #1a0c35 100%)
        `,
      },
      {
        background: `
          radial-gradient(ellipse at 25% 45%, rgba(147,51,234,0.8) 0%, transparent 34%),
          radial-gradient(ellipse at 75% 30%, rgba(244,63,94,0.65) 0%, transparent 32%),
          radial-gradient(ellipse at 55% 80%, rgba(168,85,247,0.55) 0%, transparent 36%),
          linear-gradient(145deg, #1a0c32 0%, #321a5c 50%, #180a30 100%)
        `,
      },
      {
        background: `
          radial-gradient(ellipse at 55% 40%, rgba(126,34,206,0.8) 0%, transparent 34%),
          radial-gradient(ellipse at 20% 20%, rgba(236,72,153,0.65) 0%, transparent 30%),
          radial-gradient(ellipse at 80% 70%, rgba(139,92,246,0.6) 0%, transparent 35%),
          linear-gradient(130deg, #1c0e35 0%, #2e1658 50%, #180a30 100%)
        `,
      },
    ],
  },

  // MORNING (7am-12pm) — sky blue, cyan, bright white accents. Energetic.
  morning: {
    light: [
      {
        background: `
          radial-gradient(ellipse at 30% 30%, rgba(56,189,248,0.65) 0%, transparent 45%),
          radial-gradient(ellipse at 75% 65%, rgba(34,211,238,0.4) 0%, transparent 40%),
          radial-gradient(ellipse at 50% 80%, rgba(99,179,237,0.3) 0%, transparent 45%),
          linear-gradient(135deg, #0c1a35 0%, #102848 50%, #0a1530 100%)
        `,
      },
      {
        background: `
          radial-gradient(ellipse at 65% 25%, rgba(56,189,248,0.6) 0%, transparent 42%),
          radial-gradient(ellipse at 20% 60%, rgba(103,232,249,0.4) 0%, transparent 38%),
          radial-gradient(ellipse at 80% 80%, rgba(59,130,246,0.3) 0%, transparent 42%),
          linear-gradient(150deg, #0a1830 0%, #122a4a 50%, #0c1a35 100%)
        `,
      },
      {
        background: `
          radial-gradient(ellipse at 45% 40%, rgba(34,211,238,0.55) 0%, transparent 42%),
          radial-gradient(ellipse at 80% 20%, rgba(56,189,248,0.45) 0%, transparent 38%),
          radial-gradient(ellipse at 15% 75%, rgba(96,165,250,0.3) 0%, transparent 45%),
          linear-gradient(140deg, #0c1a32 0%, #122848 48%, #0a1530 100%)
        `,
      },
    ],
    moderate: [
      {
        background: `
          radial-gradient(ellipse at 40% 35%, rgba(37,99,235,0.75) 0%, transparent 38%),
          radial-gradient(ellipse at 75% 55%, rgba(56,189,248,0.55) 0%, transparent 36%),
          radial-gradient(ellipse at 20% 70%, rgba(14,165,233,0.45) 0%, transparent 40%),
          linear-gradient(135deg, #081530 0%, #0e2550 50%, #0a1835 100%)
        `,
      },
      {
        background: `
          radial-gradient(ellipse at 60% 30%, rgba(29,78,216,0.7) 0%, transparent 36%),
          radial-gradient(ellipse at 25% 55%, rgba(56,189,248,0.55) 0%, transparent 38%),
          radial-gradient(ellipse at 80% 75%, rgba(37,99,235,0.4) 0%, transparent 36%),
          linear-gradient(145deg, #0a1830 0%, #102850 48%, #081530 100%)
        `,
      },
      {
        background: `
          radial-gradient(ellipse at 50% 45%, rgba(37,99,235,0.7) 0%, transparent 36%),
          radial-gradient(ellipse at 15% 30%, rgba(34,211,238,0.5) 0%, transparent 36%),
          radial-gradient(ellipse at 85% 65%, rgba(14,165,233,0.45) 0%, transparent 38%),
          linear-gradient(140deg, #081530 0%, #0e2550 50%, #0a1835 100%)
        `,
      },
    ],
    packed: [
      {
        background: `
          radial-gradient(ellipse at 35% 40%, rgba(29,78,216,0.85) 0%, transparent 34%),
          radial-gradient(ellipse at 70% 20%, rgba(6,182,212,0.65) 0%, transparent 30%),
          radial-gradient(ellipse at 50% 75%, rgba(37,99,235,0.6) 0%, transparent 35%),
          linear-gradient(135deg, #06102a 0%, #0c2050 50%, #081530 100%)
        `,
      },
      {
        background: `
          radial-gradient(ellipse at 25% 30%, rgba(29,78,216,0.8) 0%, transparent 32%),
          radial-gradient(ellipse at 75% 50%, rgba(14,165,233,0.6) 0%, transparent 34%),
          radial-gradient(ellipse at 45% 80%, rgba(37,99,235,0.55) 0%, transparent 34%),
          linear-gradient(148deg, #081530 0%, #0e2555 48%, #06102a 100%)
        `,
      },
      {
        background: `
          radial-gradient(ellipse at 55% 35%, rgba(29,78,216,0.82) 0%, transparent 32%),
          radial-gradient(ellipse at 20% 65%, rgba(6,182,212,0.6) 0%, transparent 34%),
          radial-gradient(ellipse at 80% 70%, rgba(37,99,235,0.55) 0%, transparent 32%),
          linear-gradient(140deg, #06102a 0%, #0c2050 50%, #081530 100%)
        `,
      },
    ],
  },

  // AFTERNOON (12-5pm) — amber, gold, warm orange. Sun-drenched.
  afternoon: {
    light: [
      {
        background: `
          radial-gradient(ellipse at 30% 40%, rgba(251,191,36,0.55) 0%, transparent 45%),
          radial-gradient(ellipse at 75% 55%, rgba(253,224,71,0.35) 0%, transparent 40%),
          radial-gradient(ellipse at 55% 20%, rgba(245,158,11,0.3) 0%, transparent 42%),
          linear-gradient(135deg, #1c1508 0%, #2e2210 50%, #1a1408 100%)
        `,
      },
      {
        background: `
          radial-gradient(ellipse at 65% 30%, rgba(245,158,11,0.5) 0%, transparent 42%),
          radial-gradient(ellipse at 20% 65%, rgba(251,191,36,0.35) 0%, transparent 40%),
          radial-gradient(ellipse at 80% 80%, rgba(253,224,71,0.25) 0%, transparent 38%),
          linear-gradient(150deg, #1a140a 0%, #2c200e 48%, #1c1508 100%)
        `,
      },
      {
        background: `
          radial-gradient(ellipse at 45% 45%, rgba(251,191,36,0.5) 0%, transparent 42%),
          radial-gradient(ellipse at 80% 25%, rgba(253,224,71,0.35) 0%, transparent 38%),
          radial-gradient(ellipse at 15% 70%, rgba(245,158,11,0.3) 0%, transparent 42%),
          linear-gradient(140deg, #1b1408 0%, #2d2110 50%, #1a1308 100%)
        `,
      },
    ],
    moderate: [
      {
        background: `
          radial-gradient(ellipse at 40% 40%, rgba(217,119,6,0.75) 0%, transparent 38%),
          radial-gradient(ellipse at 75% 25%, rgba(251,146,60,0.55) 0%, transparent 35%),
          radial-gradient(ellipse at 25% 70%, rgba(245,158,11,0.45) 0%, transparent 40%),
          linear-gradient(135deg, #1a1205 0%, #302008 50%, #181005 100%)
        `,
      },
      {
        background: `
          radial-gradient(ellipse at 60% 35%, rgba(234,88,12,0.7) 0%, transparent 36%),
          radial-gradient(ellipse at 20% 55%, rgba(251,146,60,0.5) 0%, transparent 38%),
          radial-gradient(ellipse at 80% 75%, rgba(217,119,6,0.4) 0%, transparent 36%),
          linear-gradient(145deg, #181005 0%, #2e1e08 48%, #1a1205 100%)
        `,
      },
      {
        background: `
          radial-gradient(ellipse at 50% 50%, rgba(217,119,6,0.7) 0%, transparent 36%),
          radial-gradient(ellipse at 15% 30%, rgba(251,191,36,0.5) 0%, transparent 36%),
          radial-gradient(ellipse at 85% 65%, rgba(245,158,11,0.4) 0%, transparent 38%),
          linear-gradient(140deg, #1a1208 0%, #2e1e08 50%, #181005 100%)
        `,
      },
    ],
    packed: [
      {
        background: `
          radial-gradient(ellipse at 35% 40%, rgba(180,83,9,0.85) 0%, transparent 34%),
          radial-gradient(ellipse at 70% 20%, rgba(234,88,12,0.7) 0%, transparent 30%),
          radial-gradient(ellipse at 50% 75%, rgba(217,119,6,0.55) 0%, transparent 36%),
          linear-gradient(135deg, #150e02 0%, #2a1804 50%, #120c02 100%)
        `,
      },
      {
        background: `
          radial-gradient(ellipse at 25% 35%, rgba(194,65,12,0.8) 0%, transparent 32%),
          radial-gradient(ellipse at 75% 50%, rgba(245,158,11,0.6) 0%, transparent 34%),
          radial-gradient(ellipse at 45% 80%, rgba(180,83,9,0.5) 0%, transparent 34%),
          linear-gradient(148deg, #150e02 0%, #281604 48%, #120c02 100%)
        `,
      },
      {
        background: `
          radial-gradient(ellipse at 55% 30%, rgba(180,83,9,0.82) 0%, transparent 32%),
          radial-gradient(ellipse at 20% 60%, rgba(234,88,12,0.65) 0%, transparent 34%),
          radial-gradient(ellipse at 80% 70%, rgba(217,119,6,0.5) 0%, transparent 32%),
          linear-gradient(140deg, #150e02 0%, #2a1804 50%, #120c02 100%)
        `,
      },
    ],
  },

  // GOLDEN HOUR (5-7pm) — deep orange, magenta, warm pink. Rich and intense.
  goldenHour: {
    light: [
      {
        background: `
          radial-gradient(ellipse at 30% 40%, rgba(251,146,60,0.6) 0%, transparent 45%),
          radial-gradient(ellipse at 75% 25%, rgba(244,114,182,0.45) 0%, transparent 40%),
          radial-gradient(ellipse at 55% 75%, rgba(253,186,116,0.35) 0%, transparent 45%),
          linear-gradient(135deg, #1e1208 0%, #2c1810 50%, #1a1008 100%)
        `,
      },
      {
        background: `
          radial-gradient(ellipse at 60% 35%, rgba(253,186,116,0.55) 0%, transparent 42%),
          radial-gradient(ellipse at 20% 60%, rgba(251,113,133,0.4) 0%, transparent 40%),
          radial-gradient(ellipse at 80% 80%, rgba(251,146,60,0.3) 0%, transparent 42%),
          linear-gradient(150deg, #1c1008 0%, #2a160e 48%, #1e1208 100%)
        `,
      },
      {
        background: `
          radial-gradient(ellipse at 45% 50%, rgba(251,146,60,0.55) 0%, transparent 42%),
          radial-gradient(ellipse at 80% 20%, rgba(244,114,182,0.4) 0%, transparent 38%),
          radial-gradient(ellipse at 15% 70%, rgba(253,186,116,0.3) 0%, transparent 45%),
          linear-gradient(140deg, #1d1108 0%, #2b1710 50%, #1a1008 100%)
        `,
      },
    ],
    moderate: [
      {
        background: `
          radial-gradient(ellipse at 40% 35%, rgba(234,88,12,0.8) 0%, transparent 36%),
          radial-gradient(ellipse at 75% 55%, rgba(236,72,153,0.55) 0%, transparent 34%),
          radial-gradient(ellipse at 25% 75%, rgba(251,146,60,0.45) 0%, transparent 38%),
          linear-gradient(135deg, #1a0e05 0%, #301808 50%, #180c05 100%)
        `,
      },
      {
        background: `
          radial-gradient(ellipse at 65% 40%, rgba(249,115,22,0.75) 0%, transparent 34%),
          radial-gradient(ellipse at 20% 30%, rgba(244,114,182,0.55) 0%, transparent 36%),
          radial-gradient(ellipse at 80% 75%, rgba(234,88,12,0.45) 0%, transparent 36%),
          linear-gradient(148deg, #180c05 0%, #2e1608 48%, #1a0e05 100%)
        `,
      },
      {
        background: `
          radial-gradient(ellipse at 50% 45%, rgba(234,88,12,0.75) 0%, transparent 35%),
          radial-gradient(ellipse at 15% 55%, rgba(236,72,153,0.5) 0%, transparent 36%),
          radial-gradient(ellipse at 85% 25%, rgba(251,146,60,0.4) 0%, transparent 34%),
          linear-gradient(140deg, #1a0e05 0%, #301808 50%, #180c05 100%)
        `,
      },
    ],
    packed: [
      {
        background: `
          radial-gradient(ellipse at 35% 35%, rgba(194,65,12,0.9) 0%, transparent 32%),
          radial-gradient(ellipse at 70% 20%, rgba(219,39,119,0.7) 0%, transparent 28%),
          radial-gradient(ellipse at 50% 70%, rgba(234,88,12,0.6) 0%, transparent 34%),
          linear-gradient(135deg, #150a02 0%, #2c1205 50%, #120802 100%)
        `,
      },
      {
        background: `
          radial-gradient(ellipse at 25% 40%, rgba(194,65,12,0.85) 0%, transparent 30%),
          radial-gradient(ellipse at 75% 30%, rgba(190,24,93,0.65) 0%, transparent 30%),
          radial-gradient(ellipse at 55% 80%, rgba(234,88,12,0.55) 0%, transparent 32%),
          linear-gradient(148deg, #150a02 0%, #2a1005 48%, #120802 100%)
        `,
      },
      {
        background: `
          radial-gradient(ellipse at 55% 30%, rgba(194,65,12,0.85) 0%, transparent 30%),
          radial-gradient(ellipse at 20% 60%, rgba(219,39,119,0.65) 0%, transparent 30%),
          radial-gradient(ellipse at 80% 70%, rgba(234,88,12,0.55) 0%, transparent 32%),
          linear-gradient(140deg, #150a02 0%, #2c1205 50%, #120802 100%)
        `,
      },
    ],
  },

  // EVENING (7-9pm) — teal, cool blue, subtle purple. Calming but present.
  evening: {
    light: [
      {
        background: `
          radial-gradient(ellipse at 30% 40%, rgba(20,184,166,0.55) 0%, transparent 45%),
          radial-gradient(ellipse at 75% 55%, rgba(56,189,248,0.35) 0%, transparent 40%),
          radial-gradient(ellipse at 50% 20%, rgba(45,212,191,0.3) 0%, transparent 42%),
          linear-gradient(135deg, #0a1520 0%, #0e2030 50%, #081320 100%)
        `,
      },
      {
        background: `
          radial-gradient(ellipse at 65% 35%, rgba(34,211,238,0.5) 0%, transparent 42%),
          radial-gradient(ellipse at 20% 65%, rgba(20,184,166,0.35) 0%, transparent 40%),
          radial-gradient(ellipse at 80% 80%, rgba(99,102,241,0.25) 0%, transparent 38%),
          linear-gradient(150deg, #081320 0%, #0e1e2e 48%, #0a1520 100%)
        `,
      },
      {
        background: `
          radial-gradient(ellipse at 45% 50%, rgba(20,184,166,0.5) 0%, transparent 42%),
          radial-gradient(ellipse at 80% 25%, rgba(56,189,248,0.35) 0%, transparent 38%),
          radial-gradient(ellipse at 15% 75%, rgba(45,212,191,0.25) 0%, transparent 42%),
          linear-gradient(140deg, #0a1420 0%, #0e1f2e 50%, #081320 100%)
        `,
      },
    ],
    moderate: [
      {
        background: `
          radial-gradient(ellipse at 40% 40%, rgba(13,148,136,0.75) 0%, transparent 36%),
          radial-gradient(ellipse at 75% 25%, rgba(56,189,248,0.55) 0%, transparent 34%),
          radial-gradient(ellipse at 25% 70%, rgba(79,70,229,0.4) 0%, transparent 38%),
          linear-gradient(135deg, #081018 0%, #0c1c30 50%, #0a1420 100%)
        `,
      },
      {
        background: `
          radial-gradient(ellipse at 60% 35%, rgba(6,182,212,0.7) 0%, transparent 34%),
          radial-gradient(ellipse at 20% 55%, rgba(99,102,241,0.45) 0%, transparent 36%),
          radial-gradient(ellipse at 80% 75%, rgba(13,148,136,0.4) 0%, transparent 34%),
          linear-gradient(145deg, #0a1220 0%, #0e1e30 48%, #081018 100%)
        `,
      },
      {
        background: `
          radial-gradient(ellipse at 50% 50%, rgba(13,148,136,0.7) 0%, transparent 34%),
          radial-gradient(ellipse at 15% 30%, rgba(56,189,248,0.5) 0%, transparent 34%),
          radial-gradient(ellipse at 85% 65%, rgba(79,70,229,0.4) 0%, transparent 36%),
          linear-gradient(140deg, #081018 0%, #0c1c30 50%, #0a1420 100%)
        `,
      },
    ],
    packed: [
      {
        background: `
          radial-gradient(ellipse at 35% 40%, rgba(15,118,110,0.85) 0%, transparent 32%),
          radial-gradient(ellipse at 70% 20%, rgba(67,56,202,0.65) 0%, transparent 28%),
          radial-gradient(ellipse at 50% 75%, rgba(6,182,212,0.55) 0%, transparent 34%),
          linear-gradient(135deg, #060e15 0%, #0a1828 50%, #081018 100%)
        `,
      },
      {
        background: `
          radial-gradient(ellipse at 25% 35%, rgba(13,148,136,0.8) 0%, transparent 30%),
          radial-gradient(ellipse at 75% 50%, rgba(79,70,229,0.6) 0%, transparent 32%),
          radial-gradient(ellipse at 45% 80%, rgba(6,182,212,0.5) 0%, transparent 32%),
          linear-gradient(148deg, #081018 0%, #0c1a2a 48%, #060e15 100%)
        `,
      },
      {
        background: `
          radial-gradient(ellipse at 55% 30%, rgba(15,118,110,0.8) 0%, transparent 30%),
          radial-gradient(ellipse at 20% 60%, rgba(67,56,202,0.6) 0%, transparent 32%),
          radial-gradient(ellipse at 80% 70%, rgba(6,182,212,0.5) 0%, transparent 30%),
          linear-gradient(140deg, #060e15 0%, #0a1828 50%, #081018 100%)
        `,
      },
    ],
  },

  // NIGHT (9pm-5am) — deep indigo, violet, hints of electric blue. Moody depth.
  night: {
    light: [
      {
        background: `
          radial-gradient(ellipse at 30% 40%, rgba(99,102,241,0.45) 0%, transparent 45%),
          radial-gradient(ellipse at 75% 60%, rgba(79,70,229,0.3) 0%, transparent 40%),
          radial-gradient(ellipse at 50% 20%, rgba(129,140,248,0.2) 0%, transparent 42%),
          linear-gradient(135deg, #08081a 0%, #0e0e28 50%, #060616 100%)
        `,
      },
      {
        background: `
          radial-gradient(ellipse at 65% 35%, rgba(99,102,241,0.4) 0%, transparent 42%),
          radial-gradient(ellipse at 20% 65%, rgba(67,56,202,0.25) 0%, transparent 40%),
          radial-gradient(ellipse at 80% 80%, rgba(129,140,248,0.18) 0%, transparent 38%),
          linear-gradient(150deg, #060616 0%, #0c0c24 48%, #08081a 100%)
        `,
      },
      {
        background: `
          radial-gradient(ellipse at 45% 50%, rgba(79,70,229,0.38) 0%, transparent 42%),
          radial-gradient(ellipse at 80% 25%, rgba(99,102,241,0.28) 0%, transparent 38%),
          radial-gradient(ellipse at 15% 75%, rgba(129,140,248,0.18) 0%, transparent 42%),
          linear-gradient(140deg, #08081a 0%, #0e0e28 50%, #060616 100%)
        `,
      },
    ],
    moderate: [
      {
        background: `
          radial-gradient(ellipse at 40% 40%, rgba(67,56,202,0.65) 0%, transparent 36%),
          radial-gradient(ellipse at 75% 25%, rgba(99,102,241,0.45) 0%, transparent 34%),
          radial-gradient(ellipse at 25% 70%, rgba(49,46,129,0.4) 0%, transparent 38%),
          linear-gradient(135deg, #060612 0%, #0a0a22 50%, #08081a 100%)
        `,
      },
      {
        background: `
          radial-gradient(ellipse at 60% 35%, rgba(79,70,229,0.6) 0%, transparent 34%),
          radial-gradient(ellipse at 20% 55%, rgba(99,102,241,0.4) 0%, transparent 36%),
          radial-gradient(ellipse at 80% 75%, rgba(67,56,202,0.35) 0%, transparent 34%),
          linear-gradient(145deg, #08081a 0%, #0c0c25 48%, #060612 100%)
        `,
      },
      {
        background: `
          radial-gradient(ellipse at 50% 50%, rgba(67,56,202,0.58) 0%, transparent 34%),
          radial-gradient(ellipse at 15% 30%, rgba(99,102,241,0.4) 0%, transparent 34%),
          radial-gradient(ellipse at 85% 65%, rgba(49,46,129,0.35) 0%, transparent 36%),
          linear-gradient(140deg, #060612 0%, #0a0a22 50%, #08081a 100%)
        `,
      },
    ],
    packed: [
      {
        background: `
          radial-gradient(ellipse at 35% 40%, rgba(49,46,129,0.8) 0%, transparent 30%),
          radial-gradient(ellipse at 70% 20%, rgba(79,70,229,0.65) 0%, transparent 28%),
          radial-gradient(ellipse at 50% 75%, rgba(20,184,166,0.35) 0%, transparent 32%),
          linear-gradient(135deg, #04040e 0%, #080820 50%, #060612 100%)
        `,
      },
      {
        background: `
          radial-gradient(ellipse at 25% 35%, rgba(67,56,202,0.75) 0%, transparent 28%),
          radial-gradient(ellipse at 75% 50%, rgba(49,46,129,0.6) 0%, transparent 30%),
          radial-gradient(ellipse at 45% 80%, rgba(6,182,212,0.3) 0%, transparent 30%),
          linear-gradient(148deg, #06060f 0%, #0a0a22 48%, #04040e 100%)
        `,
      },
      {
        background: `
          radial-gradient(ellipse at 55% 30%, rgba(49,46,129,0.75) 0%, transparent 28%),
          radial-gradient(ellipse at 20% 60%, rgba(79,70,229,0.6) 0%, transparent 30%),
          radial-gradient(ellipse at 80% 70%, rgba(20,184,166,0.3) 0%, transparent 28%),
          linear-gradient(140deg, #04040e 0%, #080820 50%, #060612 100%)
        `,
      },
    ],
  },
};

/**
 * Select a gradient definition, with shuffle-without-replacement.
 */
export function selectGradient(
  segment: TimeSegment,
  tier: BusynessTier,
  excludeIndices: number[],
): { gradient: GradientDef; index: number } | null {
  const defs = gradients[segment]?.[tier];
  if (!defs || defs.length === 0) return null;

  let available = defs.map((g, i) => ({ gradient: g, index: i })).filter(
    (entry) => !excludeIndices.includes(entry.index)
  );

  if (available.length === 0) {
    available = defs.map((g, i) => ({ gradient: g, index: i }));
  }

  return available[Math.floor(Math.random() * available.length)];
}
