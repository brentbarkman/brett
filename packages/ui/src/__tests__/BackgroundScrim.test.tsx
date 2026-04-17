import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BackgroundScrim } from "../BackgroundScrim";

describe("BackgroundScrim", () => {
  it("renders an aria-hidden absolute full-viewport overlay", () => {
    const { container } = render(<BackgroundScrim />);
    const div = container.firstChild as HTMLDivElement;

    expect(div).toBeTruthy();
    expect(div.getAttribute("aria-hidden")).toBe("true");
    expect(div.className).toContain("absolute");
    expect(div.className).toContain("inset-0");
    expect(div.className).toContain("pointer-events-none");
  });

  it("has a radial-gradient background centered at 30%/45%", () => {
    const { container } = render(<BackgroundScrim />);
    const div = container.firstChild as HTMLDivElement;

    expect(div.style.background).toContain("radial-gradient");
    expect(div.style.background).toContain("30% 45%");
    expect(div.style.background).toContain("rgba(0, 0, 0, 0.25)");
  });
});
