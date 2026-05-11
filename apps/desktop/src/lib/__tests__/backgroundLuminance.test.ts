import { describe, it, expect, beforeEach } from "vitest";
import {
  linearize,
  relativeLuminance,
  luminanceFromHex,
  applyHysteresis,
  getCachedLuminance,
  setCachedLuminance,
  IS_LIGHT_THRESHOLD_HIGH,
  IS_LIGHT_THRESHOLD_LOW,
} from "../backgroundLuminance";

describe("linearize", () => {
  it("passes pure black through unchanged", () => {
    expect(linearize(0)).toBe(0);
  });

  it("passes pure white through to 1.0 (WCAG identity)", () => {
    // Critical: if this drifts, the threshold calibration is off
    // by a factor of whatever rounding the gamma curve picked up.
    expect(linearize(1)).toBeCloseTo(1.0, 9);
  });

  it("uses the linear branch below the 0.03928 elbow", () => {
    expect(linearize(0.02)).toBeCloseTo(0.02 / 12.92, 9);
  });

  it("clamps negative and >1 input", () => {
    expect(linearize(-0.5)).toBe(0);
    expect(linearize(2.0)).toBe(1);
  });
});

describe("relativeLuminance", () => {
  it("returns 0 for pure black", () => {
    expect(relativeLuminance(0, 0, 0)).toBe(0);
  });

  it("returns 1 for pure white", () => {
    expect(relativeLuminance(1, 1, 1)).toBeCloseTo(1.0, 9);
  });

  it("weights green > red > blue", () => {
    // Pin the WCAG coefficient ordering. If a refactor swaps weights
    // (a common mistake when transcribing 0.2126/0.7152/0.0722) the
    // dark-text decision would invert on red-dominant photos.
    const r = relativeLuminance(0.5, 0, 0);
    const g = relativeLuminance(0, 0.5, 0);
    const b = relativeLuminance(0, 0, 0.5);
    expect(g).toBeGreaterThan(r);
    expect(r).toBeGreaterThan(b);
  });
});

describe("luminanceFromHex", () => {
  it("parses with and without the leading hash", () => {
    expect(luminanceFromHex("#FFFFFF")).toBeCloseTo(1.0, 6);
    expect(luminanceFromHex("FFFFFF")).toBeCloseTo(1.0, 6);
  });

  it("returns 0 for pure black", () => {
    expect(luminanceFromHex("#000000")).toBe(0);
  });

  it("returns null for malformed input", () => {
    expect(luminanceFromHex("not-a-color")).toBeNull();
    expect(luminanceFromHex("#FFF")).toBeNull();
    expect(luminanceFromHex("")).toBeNull();
  });

  it("places the default umber wash well below the LOW threshold", () => {
    // Sanity-check the named-default-stays-white-text contract: if
    // someone bumps the burnt-umber wash brighter, we want this test
    // to fail so they remember to retune the threshold or accept a
    // visible swap on the default color.
    const umber = luminanceFromHex("#1A1612");
    expect(umber).not.toBeNull();
    expect(umber!).toBeLessThan(IS_LIGHT_THRESHOLD_LOW);
  });
});

describe("applyHysteresis", () => {
  it("starts in dark state until luminance crosses HIGH", () => {
    expect(applyHysteresis(false, 0.0)).toBe(false);
    expect(applyHysteresis(false, IS_LIGHT_THRESHOLD_HIGH)).toBe(false);
    expect(applyHysteresis(false, IS_LIGHT_THRESHOLD_HIGH + 0.01)).toBe(true);
  });

  it("keeps light state while luminance >= LOW", () => {
    // The whole point of the deadband: once we've committed to dark
    // text on a bright photo, a slightly dimmer follow-up photo must
    // NOT flip back to white text. Walks rotation neighbors that all
    // land in [LOW, HIGH].
    const midDeadband = (IS_LIGHT_THRESHOLD_LOW + IS_LIGHT_THRESHOLD_HIGH) / 2;
    expect(applyHysteresis(true, IS_LIGHT_THRESHOLD_HIGH)).toBe(true);
    expect(applyHysteresis(true, midDeadband)).toBe(true);
    expect(applyHysteresis(true, IS_LIGHT_THRESHOLD_LOW)).toBe(true);
  });

  it("flips light → dark only below LOW", () => {
    expect(applyHysteresis(true, IS_LIGHT_THRESHOLD_LOW - 0.01)).toBe(false);
    expect(applyHysteresis(true, 0.0)).toBe(false);
  });

  it("flips dark → light only above HIGH", () => {
    // Anything in the deadband must NOT flip from dark to light —
    // crossing HIGH is required. The midpoint is the strongest test
    // because it's also the easiest case for either threshold to be
    // wrong about.
    const midDeadband = (IS_LIGHT_THRESHOLD_LOW + IS_LIGHT_THRESHOLD_HIGH) / 2;
    expect(applyHysteresis(false, IS_LIGHT_THRESHOLD_LOW)).toBe(false);
    expect(applyHysteresis(false, midDeadband)).toBe(false);
    expect(applyHysteresis(false, IS_LIGHT_THRESHOLD_HIGH)).toBe(false);
  });
});

describe("luminance cache", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns null for an unseen URL", () => {
    expect(getCachedLuminance("https://example.com/a.webp")).toBeNull();
  });

  it("round-trips a value", () => {
    setCachedLuminance("https://example.com/a.webp", 0.42);
    expect(getCachedLuminance("https://example.com/a.webp")).toBe(0.42);
  });

  it("keeps multiple URLs independent", () => {
    setCachedLuminance("a", 0.1);
    setCachedLuminance("b", 0.9);
    expect(getCachedLuminance("a")).toBe(0.1);
    expect(getCachedLuminance("b")).toBe(0.9);
  });

  it("ignores empty URLs in both directions", () => {
    setCachedLuminance("", 0.5);
    expect(getCachedLuminance("")).toBeNull();
  });

  it("survives a malformed cache entry", () => {
    // If localStorage ever gets stomped (by a user, by a corrupt
    // write), the sampler must keep working. Returning null tells
    // the hook to re-sample, which heals the cache on next decode.
    localStorage.setItem("brett.background.luminance.v1", "{not json");
    expect(getCachedLuminance("a")).toBeNull();
  });
});
