import type { TimeSegment, BusynessTier } from "@brett/business";

/**
 * CSS gradient definitions for the abstract background set.
 * Each gradient is a CSS `background` shorthand (layered radial + linear gradients).
 * Designed to evoke the same emotional mapping as the photography set:
 * - Time of day controls hue (cool dawn → warm afternoon → deep night)
 * - Busyness controls saturation and density (light = diffuse, packed = intense)
 *
 * 3 gradients per category for rotation variety (matching photography set structure).
 */

export interface GradientDef {
  background: string;
}

type GradientMap = Record<TimeSegment, Record<BusynessTier, GradientDef[]>>;

export const gradients: GradientMap = {
  // DAWN (5-7am) — cool lavenders, soft pinks, hints of peach
  dawn: {
    light: [
      {
        background: `
          radial-gradient(ellipse at 20% 50%, rgba(196,181,253,0.4) 0%, transparent 50%),
          radial-gradient(ellipse at 80% 20%, rgba(251,207,232,0.3) 0%, transparent 40%),
          radial-gradient(ellipse at 50% 80%, rgba(221,214,254,0.2) 0%, transparent 60%),
          linear-gradient(135deg, #1e1b2e 0%, #2d2545 50%, #1a1525 100%)
        `,
      },
      {
        background: `
          radial-gradient(ellipse at 70% 30%, rgba(196,181,253,0.35) 0%, transparent 45%),
          radial-gradient(ellipse at 20% 70%, rgba(244,194,194,0.25) 0%, transparent 50%),
          radial-gradient(ellipse at 90% 80%, rgba(167,139,250,0.15) 0%, transparent 40%),
          linear-gradient(160deg, #1a1628 0%, #261e3d 50%, #1e1830 100%)
        `,
      },
      {
        background: `
          radial-gradient(ellipse at 40% 20%, rgba(221,214,254,0.35) 0%, transparent 50%),
          radial-gradient(ellipse at 80% 60%, rgba(251,207,232,0.25) 0%, transparent 45%),
          radial-gradient(ellipse at 10% 80%, rgba(196,181,253,0.2) 0%, transparent 55%),
          linear-gradient(145deg, #1e1a30 0%, #28203f 40%, #1c1628 100%)
        `,
      },
    ],
    moderate: [
      {
        background: `
          radial-gradient(ellipse at 30% 40%, rgba(196,181,253,0.5) 0%, transparent 45%),
          radial-gradient(ellipse at 75% 25%, rgba(251,191,210,0.4) 0%, transparent 40%),
          radial-gradient(ellipse at 60% 75%, rgba(167,139,250,0.3) 0%, transparent 50%),
          linear-gradient(135deg, #1e1b2e 0%, #312650 50%, #1a1525 100%)
        `,
      },
      {
        background: `
          radial-gradient(ellipse at 60% 30%, rgba(216,180,254,0.45) 0%, transparent 40%),
          radial-gradient(ellipse at 20% 60%, rgba(251,207,232,0.35) 0%, transparent 45%),
          radial-gradient(ellipse at 85% 70%, rgba(192,168,252,0.25) 0%, transparent 50%),
          linear-gradient(150deg, #1c1830 0%, #2e2448 45%, #1e1a32 100%)
        `,
      },
      {
        background: `
          radial-gradient(ellipse at 45% 55%, rgba(196,181,253,0.5) 0%, transparent 40%),
          radial-gradient(ellipse at 80% 20%, rgba(244,194,210,0.35) 0%, transparent 45%),
          radial-gradient(ellipse at 15% 25%, rgba(167,139,250,0.3) 0%, transparent 50%),
          linear-gradient(140deg, #1e1b30 0%, #2d2348 50%, #1b1628 100%)
        `,
      },
    ],
    packed: [
      {
        background: `
          radial-gradient(ellipse at 35% 35%, rgba(167,139,250,0.6) 0%, transparent 40%),
          radial-gradient(ellipse at 70% 20%, rgba(232,170,200,0.5) 0%, transparent 35%),
          radial-gradient(ellipse at 55% 70%, rgba(139,92,246,0.4) 0%, transparent 45%),
          linear-gradient(135deg, #1a1530 0%, #352858 50%, #1e1630 100%)
        `,
      },
      {
        background: `
          radial-gradient(ellipse at 25% 50%, rgba(139,92,246,0.55) 0%, transparent 40%),
          radial-gradient(ellipse at 75% 30%, rgba(244,170,196,0.45) 0%, transparent 38%),
          radial-gradient(ellipse at 50% 80%, rgba(167,139,250,0.35) 0%, transparent 42%),
          linear-gradient(145deg, #1c1632 0%, #30255a 50%, #1a1428 100%)
        `,
      },
      {
        background: `
          radial-gradient(ellipse at 50% 40%, rgba(167,139,250,0.55) 0%, transparent 38%),
          radial-gradient(ellipse at 20% 20%, rgba(232,170,210,0.45) 0%, transparent 35%),
          radial-gradient(ellipse at 80% 70%, rgba(139,92,246,0.4) 0%, transparent 40%),
          linear-gradient(130deg, #1e1835 0%, #332860 50%, #1c1530 100%)
        `,
      },
    ],
  },

  // MORNING (7am-12pm) — bright blues, airy whites, energetic
  morning: {
    light: [
      {
        background: `
          radial-gradient(ellipse at 30% 30%, rgba(147,197,253,0.35) 0%, transparent 50%),
          radial-gradient(ellipse at 70% 70%, rgba(165,210,255,0.2) 0%, transparent 45%),
          radial-gradient(ellipse at 80% 20%, rgba(199,220,255,0.15) 0%, transparent 40%),
          linear-gradient(135deg, #141c2e 0%, #1a2540 50%, #121a28 100%)
        `,
      },
      {
        background: `
          radial-gradient(ellipse at 60% 25%, rgba(147,197,253,0.3) 0%, transparent 50%),
          radial-gradient(ellipse at 25% 65%, rgba(186,220,255,0.2) 0%, transparent 45%),
          radial-gradient(ellipse at 85% 75%, rgba(165,200,245,0.15) 0%, transparent 40%),
          linear-gradient(150deg, #121a2a 0%, #1c2842 50%, #141c2e 100%)
        `,
      },
      {
        background: `
          radial-gradient(ellipse at 50% 40%, rgba(165,210,255,0.3) 0%, transparent 48%),
          radial-gradient(ellipse at 15% 20%, rgba(147,197,253,0.2) 0%, transparent 42%),
          radial-gradient(ellipse at 75% 80%, rgba(186,215,250,0.15) 0%, transparent 50%),
          linear-gradient(140deg, #131b2c 0%, #1b2640 48%, #121828 100%)
        `,
      },
    ],
    moderate: [
      {
        background: `
          radial-gradient(ellipse at 40% 35%, rgba(96,165,250,0.45) 0%, transparent 42%),
          radial-gradient(ellipse at 75% 60%, rgba(147,197,253,0.3) 0%, transparent 40%),
          radial-gradient(ellipse at 20% 75%, rgba(59,130,246,0.2) 0%, transparent 45%),
          linear-gradient(135deg, #111a2e 0%, #1a2d50 50%, #101828 100%)
        `,
      },
      {
        background: `
          radial-gradient(ellipse at 65% 30%, rgba(96,165,250,0.4) 0%, transparent 40%),
          radial-gradient(ellipse at 25% 55%, rgba(147,197,253,0.3) 0%, transparent 42%),
          radial-gradient(ellipse at 80% 80%, rgba(59,130,246,0.2) 0%, transparent 38%),
          linear-gradient(145deg, #121c30 0%, #1c2f52 48%, #111a2a 100%)
        `,
      },
      {
        background: `
          radial-gradient(ellipse at 50% 50%, rgba(96,165,250,0.42) 0%, transparent 40%),
          radial-gradient(ellipse at 15% 30%, rgba(147,197,253,0.28) 0%, transparent 42%),
          radial-gradient(ellipse at 85% 70%, rgba(59,130,246,0.2) 0%, transparent 40%),
          linear-gradient(140deg, #111b2e 0%, #1b2e50 50%, #101828 100%)
        `,
      },
    ],
    packed: [
      {
        background: `
          radial-gradient(ellipse at 35% 40%, rgba(59,130,246,0.55) 0%, transparent 38%),
          radial-gradient(ellipse at 70% 25%, rgba(96,165,250,0.4) 0%, transparent 35%),
          radial-gradient(ellipse at 50% 75%, rgba(37,99,235,0.35) 0%, transparent 40%),
          linear-gradient(135deg, #0f1828 0%, #1a3060 50%, #0e1525 100%)
        `,
      },
      {
        background: `
          radial-gradient(ellipse at 25% 30%, rgba(59,130,246,0.5) 0%, transparent 36%),
          radial-gradient(ellipse at 75% 55%, rgba(96,165,250,0.38) 0%, transparent 38%),
          radial-gradient(ellipse at 45% 80%, rgba(37,99,235,0.3) 0%, transparent 42%),
          linear-gradient(150deg, #101a2c 0%, #1c3262 48%, #0f1628 100%)
        `,
      },
      {
        background: `
          radial-gradient(ellipse at 55% 35%, rgba(59,130,246,0.52) 0%, transparent 36%),
          radial-gradient(ellipse at 20% 65%, rgba(37,99,235,0.4) 0%, transparent 38%),
          radial-gradient(ellipse at 80% 75%, rgba(96,165,250,0.3) 0%, transparent 35%),
          linear-gradient(140deg, #0f182a 0%, #1b3058 50%, #0e1525 100%)
        `,
      },
    ],
  },

  // AFTERNOON (12-5pm) — warm ambers, golds, steady
  afternoon: {
    light: [
      {
        background: `
          radial-gradient(ellipse at 30% 35%, rgba(251,191,36,0.25) 0%, transparent 50%),
          radial-gradient(ellipse at 75% 60%, rgba(253,224,167,0.15) 0%, transparent 45%),
          radial-gradient(ellipse at 50% 80%, rgba(245,208,140,0.1) 0%, transparent 50%),
          linear-gradient(135deg, #1c1a14 0%, #2a2418 50%, #1a1812 100%)
        `,
      },
      {
        background: `
          radial-gradient(ellipse at 65% 30%, rgba(251,191,36,0.22) 0%, transparent 48%),
          radial-gradient(ellipse at 20% 65%, rgba(253,224,167,0.14) 0%, transparent 42%),
          radial-gradient(ellipse at 80% 80%, rgba(245,208,140,0.1) 0%, transparent 45%),
          linear-gradient(150deg, #1a1814 0%, #28221a 48%, #1c1a14 100%)
        `,
      },
      {
        background: `
          radial-gradient(ellipse at 45% 45%, rgba(253,224,167,0.2) 0%, transparent 48%),
          radial-gradient(ellipse at 80% 25%, rgba(251,191,36,0.15) 0%, transparent 42%),
          radial-gradient(ellipse at 15% 75%, rgba(245,208,140,0.1) 0%, transparent 50%),
          linear-gradient(140deg, #1b1914 0%, #292318 50%, #1a1812 100%)
        `,
      },
    ],
    moderate: [
      {
        background: `
          radial-gradient(ellipse at 40% 40%, rgba(245,158,11,0.4) 0%, transparent 42%),
          radial-gradient(ellipse at 75% 25%, rgba(251,191,36,0.3) 0%, transparent 38%),
          radial-gradient(ellipse at 25% 70%, rgba(253,186,80,0.2) 0%, transparent 45%),
          linear-gradient(135deg, #1c1810 0%, #30280e 50%, #1a160e 100%)
        `,
      },
      {
        background: `
          radial-gradient(ellipse at 60% 35%, rgba(245,158,11,0.38) 0%, transparent 40%),
          radial-gradient(ellipse at 20% 55%, rgba(251,191,36,0.28) 0%, transparent 40%),
          radial-gradient(ellipse at 80% 75%, rgba(253,186,80,0.18) 0%, transparent 42%),
          linear-gradient(145deg, #1b1710 0%, #2e2610 48%, #1a1610 100%)
        `,
      },
      {
        background: `
          radial-gradient(ellipse at 50% 50%, rgba(245,158,11,0.36) 0%, transparent 40%),
          radial-gradient(ellipse at 15% 30%, rgba(251,191,36,0.26) 0%, transparent 38%),
          radial-gradient(ellipse at 85% 65%, rgba(253,186,80,0.18) 0%, transparent 40%),
          linear-gradient(138deg, #1c1812 0%, #2f270e 50%, #1a160e 100%)
        `,
      },
    ],
    packed: [
      {
        background: `
          radial-gradient(ellipse at 35% 40%, rgba(217,119,6,0.55) 0%, transparent 38%),
          radial-gradient(ellipse at 70% 20%, rgba(245,158,11,0.4) 0%, transparent 35%),
          radial-gradient(ellipse at 50% 75%, rgba(180,83,9,0.3) 0%, transparent 40%),
          linear-gradient(135deg, #1a1508 0%, #352808 50%, #18140a 100%)
        `,
      },
      {
        background: `
          radial-gradient(ellipse at 25% 35%, rgba(217,119,6,0.5) 0%, transparent 36%),
          radial-gradient(ellipse at 75% 50%, rgba(245,158,11,0.38) 0%, transparent 38%),
          radial-gradient(ellipse at 45% 80%, rgba(180,83,9,0.28) 0%, transparent 38%),
          linear-gradient(148deg, #1b160a 0%, #33270a 48%, #19140a 100%)
        `,
      },
      {
        background: `
          radial-gradient(ellipse at 55% 30%, rgba(217,119,6,0.52) 0%, transparent 36%),
          radial-gradient(ellipse at 20% 60%, rgba(180,83,9,0.4) 0%, transparent 38%),
          radial-gradient(ellipse at 80% 70%, rgba(245,158,11,0.3) 0%, transparent 35%),
          linear-gradient(140deg, #1a150a 0%, #342808 50%, #18140a 100%)
        `,
      },
    ],
  },

  // GOLDEN HOUR (5-7pm) — rich oranges, deep golds, warm pinks
  goldenHour: {
    light: [
      {
        background: `
          radial-gradient(ellipse at 30% 40%, rgba(251,146,60,0.3) 0%, transparent 48%),
          radial-gradient(ellipse at 75% 25%, rgba(253,186,116,0.2) 0%, transparent 42%),
          radial-gradient(ellipse at 50% 75%, rgba(251,191,210,0.15) 0%, transparent 50%),
          linear-gradient(135deg, #1e1610 0%, #2a1e14 50%, #1c1410 100%)
        `,
      },
      {
        background: `
          radial-gradient(ellipse at 60% 30%, rgba(251,146,60,0.28) 0%, transparent 45%),
          radial-gradient(ellipse at 20% 60%, rgba(253,186,116,0.18) 0%, transparent 42%),
          radial-gradient(ellipse at 80% 80%, rgba(244,194,194,0.12) 0%, transparent 48%),
          linear-gradient(150deg, #1c1410 0%, #281c12 48%, #1e1610 100%)
        `,
      },
      {
        background: `
          radial-gradient(ellipse at 45% 50%, rgba(253,186,116,0.25) 0%, transparent 45%),
          radial-gradient(ellipse at 80% 20%, rgba(251,146,60,0.18) 0%, transparent 40%),
          radial-gradient(ellipse at 15% 70%, rgba(251,191,210,0.12) 0%, transparent 48%),
          linear-gradient(140deg, #1d1510 0%, #291d14 50%, #1c1410 100%)
        `,
      },
    ],
    moderate: [
      {
        background: `
          radial-gradient(ellipse at 40% 35%, rgba(234,88,12,0.45) 0%, transparent 40%),
          radial-gradient(ellipse at 75% 55%, rgba(251,146,60,0.35) 0%, transparent 38%),
          radial-gradient(ellipse at 25% 75%, rgba(244,170,196,0.2) 0%, transparent 42%),
          linear-gradient(135deg, #1c140c 0%, #30200c 50%, #1a120a 100%)
        `,
      },
      {
        background: `
          radial-gradient(ellipse at 65% 40%, rgba(234,88,12,0.42) 0%, transparent 38%),
          radial-gradient(ellipse at 20% 30%, rgba(251,146,60,0.32) 0%, transparent 40%),
          radial-gradient(ellipse at 80% 75%, rgba(232,170,200,0.18) 0%, transparent 40%),
          linear-gradient(148deg, #1b130c 0%, #2e1e0e 48%, #1a120c 100%)
        `,
      },
      {
        background: `
          radial-gradient(ellipse at 50% 45%, rgba(234,88,12,0.43) 0%, transparent 38%),
          radial-gradient(ellipse at 15% 55%, rgba(251,146,60,0.3) 0%, transparent 40%),
          radial-gradient(ellipse at 85% 25%, rgba(244,170,196,0.18) 0%, transparent 38%),
          linear-gradient(140deg, #1c140e 0%, #301f0c 50%, #1a120a 100%)
        `,
      },
    ],
    packed: [
      {
        background: `
          radial-gradient(ellipse at 35% 35%, rgba(194,65,12,0.55) 0%, transparent 36%),
          radial-gradient(ellipse at 70% 20%, rgba(234,88,12,0.45) 0%, transparent 34%),
          radial-gradient(ellipse at 50% 70%, rgba(190,50,100,0.3) 0%, transparent 38%),
          linear-gradient(135deg, #1a1008 0%, #351a08 50%, #180e08 100%)
        `,
      },
      {
        background: `
          radial-gradient(ellipse at 25% 40%, rgba(194,65,12,0.5) 0%, transparent 35%),
          radial-gradient(ellipse at 75% 30%, rgba(234,88,12,0.42) 0%, transparent 36%),
          radial-gradient(ellipse at 55% 80%, rgba(190,50,100,0.28) 0%, transparent 36%),
          linear-gradient(148deg, #1b110a 0%, #33190a 48%, #19100a 100%)
        `,
      },
      {
        background: `
          radial-gradient(ellipse at 55% 30%, rgba(194,65,12,0.52) 0%, transparent 34%),
          radial-gradient(ellipse at 20% 60%, rgba(190,50,100,0.38) 0%, transparent 36%),
          radial-gradient(ellipse at 80% 70%, rgba(234,88,12,0.35) 0%, transparent 34%),
          linear-gradient(140deg, #1a1008 0%, #341a08 50%, #180e08 100%)
        `,
      },
    ],
  },

  // EVENING (7-9pm) — cool blues, teals, calming
  evening: {
    light: [
      {
        background: `
          radial-gradient(ellipse at 30% 40%, rgba(56,189,248,0.25) 0%, transparent 48%),
          radial-gradient(ellipse at 75% 60%, rgba(94,170,210,0.15) 0%, transparent 42%),
          radial-gradient(ellipse at 50% 20%, rgba(103,180,220,0.1) 0%, transparent 45%),
          linear-gradient(135deg, #0f1720 0%, #152230 50%, #0e1520 100%)
        `,
      },
      {
        background: `
          radial-gradient(ellipse at 65% 35%, rgba(56,189,248,0.22) 0%, transparent 45%),
          radial-gradient(ellipse at 20% 65%, rgba(94,170,210,0.14) 0%, transparent 42%),
          radial-gradient(ellipse at 80% 80%, rgba(103,180,220,0.1) 0%, transparent 40%),
          linear-gradient(150deg, #0e1620 0%, #14202e 48%, #0f1720 100%)
        `,
      },
      {
        background: `
          radial-gradient(ellipse at 45% 50%, rgba(94,170,210,0.2) 0%, transparent 45%),
          radial-gradient(ellipse at 80% 25%, rgba(56,189,248,0.15) 0%, transparent 40%),
          radial-gradient(ellipse at 15% 75%, rgba(103,180,220,0.1) 0%, transparent 48%),
          linear-gradient(140deg, #0f1620 0%, #152230 50%, #0e1520 100%)
        `,
      },
    ],
    moderate: [
      {
        background: `
          radial-gradient(ellipse at 40% 40%, rgba(20,148,204,0.4) 0%, transparent 40%),
          radial-gradient(ellipse at 75% 25%, rgba(56,189,248,0.3) 0%, transparent 38%),
          radial-gradient(ellipse at 25% 70%, rgba(8,120,180,0.2) 0%, transparent 42%),
          linear-gradient(135deg, #0c1420 0%, #122438 50%, #0b1220 100%)
        `,
      },
      {
        background: `
          radial-gradient(ellipse at 60% 35%, rgba(20,148,204,0.38) 0%, transparent 38%),
          radial-gradient(ellipse at 20% 55%, rgba(56,189,248,0.28) 0%, transparent 40%),
          radial-gradient(ellipse at 80% 75%, rgba(8,120,180,0.18) 0%, transparent 38%),
          linear-gradient(148deg, #0d1522 0%, #132536 48%, #0c1420 100%)
        `,
      },
      {
        background: `
          radial-gradient(ellipse at 50% 50%, rgba(20,148,204,0.36) 0%, transparent 38%),
          radial-gradient(ellipse at 15% 30%, rgba(56,189,248,0.26) 0%, transparent 38%),
          radial-gradient(ellipse at 85% 65%, rgba(8,120,180,0.18) 0%, transparent 40%),
          linear-gradient(140deg, #0c1420 0%, #122436 50%, #0b1220 100%)
        `,
      },
    ],
    packed: [
      {
        background: `
          radial-gradient(ellipse at 35% 40%, rgba(6,95,160,0.5) 0%, transparent 36%),
          radial-gradient(ellipse at 70% 20%, rgba(20,148,204,0.4) 0%, transparent 34%),
          radial-gradient(ellipse at 50% 75%, rgba(88,60,160,0.3) 0%, transparent 38%),
          linear-gradient(135deg, #0a1018 0%, #102040 50%, #0a0e18 100%)
        `,
      },
      {
        background: `
          radial-gradient(ellipse at 25% 35%, rgba(6,95,160,0.48) 0%, transparent 35%),
          radial-gradient(ellipse at 75% 50%, rgba(20,148,204,0.38) 0%, transparent 36%),
          radial-gradient(ellipse at 45% 80%, rgba(88,60,160,0.28) 0%, transparent 36%),
          linear-gradient(148deg, #0b1118 0%, #111f3e 48%, #0a0e18 100%)
        `,
      },
      {
        background: `
          radial-gradient(ellipse at 55% 30%, rgba(6,95,160,0.48) 0%, transparent 35%),
          radial-gradient(ellipse at 20% 60%, rgba(88,60,160,0.38) 0%, transparent 36%),
          radial-gradient(ellipse at 80% 70%, rgba(20,148,204,0.3) 0%, transparent 34%),
          linear-gradient(140deg, #0a1018 0%, #101e3e 50%, #0a0e18 100%)
        `,
      },
    ],
  },

  // NIGHT (9pm-5am) — deep indigos, dark navy, minimal
  night: {
    light: [
      {
        background: `
          radial-gradient(ellipse at 30% 40%, rgba(99,80,170,0.2) 0%, transparent 48%),
          radial-gradient(ellipse at 75% 60%, rgba(60,50,120,0.12) 0%, transparent 42%),
          radial-gradient(ellipse at 50% 20%, rgba(80,65,140,0.08) 0%, transparent 45%),
          linear-gradient(135deg, #0a0c18 0%, #10122a 50%, #080a14 100%)
        `,
      },
      {
        background: `
          radial-gradient(ellipse at 65% 35%, rgba(99,80,170,0.18) 0%, transparent 45%),
          radial-gradient(ellipse at 20% 65%, rgba(60,50,120,0.1) 0%, transparent 42%),
          radial-gradient(ellipse at 80% 80%, rgba(80,65,140,0.08) 0%, transparent 40%),
          linear-gradient(150deg, #090b16 0%, #0f1128 48%, #0a0c18 100%)
        `,
      },
      {
        background: `
          radial-gradient(ellipse at 45% 50%, rgba(60,50,120,0.16) 0%, transparent 45%),
          radial-gradient(ellipse at 80% 25%, rgba(99,80,170,0.12) 0%, transparent 40%),
          radial-gradient(ellipse at 15% 75%, rgba(80,65,140,0.08) 0%, transparent 48%),
          linear-gradient(140deg, #0a0b16 0%, #10122a 50%, #080a14 100%)
        `,
      },
    ],
    moderate: [
      {
        background: `
          radial-gradient(ellipse at 40% 40%, rgba(79,60,150,0.3) 0%, transparent 40%),
          radial-gradient(ellipse at 75% 25%, rgba(99,80,170,0.2) 0%, transparent 38%),
          radial-gradient(ellipse at 25% 70%, rgba(50,40,110,0.15) 0%, transparent 42%),
          linear-gradient(135deg, #080a15 0%, #0e1430 50%, #070912 100%)
        `,
      },
      {
        background: `
          radial-gradient(ellipse at 60% 35%, rgba(79,60,150,0.28) 0%, transparent 38%),
          radial-gradient(ellipse at 20% 55%, rgba(99,80,170,0.18) 0%, transparent 40%),
          radial-gradient(ellipse at 80% 75%, rgba(50,40,110,0.14) 0%, transparent 38%),
          linear-gradient(148deg, #090b16 0%, #0f152e 48%, #080a14 100%)
        `,
      },
      {
        background: `
          radial-gradient(ellipse at 50% 50%, rgba(79,60,150,0.26) 0%, transparent 38%),
          radial-gradient(ellipse at 15% 30%, rgba(99,80,170,0.18) 0%, transparent 38%),
          radial-gradient(ellipse at 85% 65%, rgba(50,40,110,0.14) 0%, transparent 40%),
          linear-gradient(140deg, #080a14 0%, #0e1430 50%, #070912 100%)
        `,
      },
    ],
    packed: [
      {
        background: `
          radial-gradient(ellipse at 35% 40%, rgba(50,30,120,0.45) 0%, transparent 36%),
          radial-gradient(ellipse at 70% 20%, rgba(79,60,150,0.35) 0%, transparent 34%),
          radial-gradient(ellipse at 50% 75%, rgba(20,100,80,0.2) 0%, transparent 38%),
          linear-gradient(135deg, #06080f 0%, #0c1028 50%, #05070e 100%)
        `,
      },
      {
        background: `
          radial-gradient(ellipse at 25% 35%, rgba(50,30,120,0.42) 0%, transparent 35%),
          radial-gradient(ellipse at 75% 50%, rgba(79,60,150,0.32) 0%, transparent 36%),
          radial-gradient(ellipse at 45% 80%, rgba(20,100,80,0.18) 0%, transparent 36%),
          linear-gradient(148deg, #070910 0%, #0d1126 48%, #06080f 100%)
        `,
      },
      {
        background: `
          radial-gradient(ellipse at 55% 30%, rgba(50,30,120,0.42) 0%, transparent 34%),
          radial-gradient(ellipse at 20% 60%, rgba(20,100,80,0.28) 0%, transparent 36%),
          radial-gradient(ellipse at 80% 70%, rgba(79,60,150,0.3) 0%, transparent 34%),
          linear-gradient(140deg, #06080f 0%, #0c1028 50%, #05070e 100%)
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
