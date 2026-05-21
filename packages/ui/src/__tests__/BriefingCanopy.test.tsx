import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BriefingCanopy } from "../BriefingCanopy";

describe("BriefingCanopy", () => {
  it("renders an aria-hidden top-anchored overlay", () => {
    const { container } = render(<BriefingCanopy />);
    const div = container.firstChild as HTMLDivElement;

    expect(div).toBeTruthy();
    expect(div.getAttribute("aria-hidden")).toBe("true");
    expect(div.className).toContain("absolute");
    expect(div.className).toContain("inset-x-0");
    expect(div.className).toContain("top-0");
    expect(div.className).toContain("pointer-events-none");
  });

  it("uses the V2 linear gradient (0.55 → 0.26 → transparent) at 55% height", () => {
    const { container } = render(<BriefingCanopy />);
    const div = container.firstChild as HTMLDivElement;

    expect(div.style.height).toBe("55%");
    expect(div.style.background).toContain("linear-gradient");
    expect(div.style.background).toContain("180deg");
    expect(div.style.background).toContain("rgba(0, 0, 0, 0.55)");
    expect(div.style.background).toContain("rgba(0, 0, 0, 0.26)");
    expect(div.style.background).toContain("transparent");
  });
});
