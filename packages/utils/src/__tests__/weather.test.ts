import { describe, it, expect } from "vitest";
import { resolveTempUnit, convertTemp } from "../weather.js";

describe("resolveTempUnit", () => {
  it("returns fahrenheit when explicitly set", () => {
    expect(resolveTempUnit("fahrenheit")).toBe("fahrenheit");
  });
  it("returns celsius when explicitly set", () => {
    expect(resolveTempUnit("celsius")).toBe("celsius");
  });
  it("returns fahrenheit for US with auto", () => {
    expect(resolveTempUnit("auto", "US")).toBe("fahrenheit");
  });
  it("returns celsius for non-US with auto", () => {
    expect(resolveTempUnit("auto", "GB")).toBe("celsius");
  });
  it("returns celsius when auto with no country", () => {
    expect(resolveTempUnit("auto")).toBe("celsius");
  });
});

describe("convertTemp", () => {
  it("converts 0°C to 32°F", () => {
    expect(convertTemp(0, "fahrenheit")).toBe(32);
  });
  it("converts 100°C to 212°F", () => {
    expect(convertTemp(100, "fahrenheit")).toBe(212);
  });
  it("rounds celsius", () => {
    expect(convertTemp(22.7, "celsius")).toBe(23);
  });
  it("returns rounded celsius unchanged", () => {
    expect(convertTemp(22, "celsius")).toBe(22);
  });
});
