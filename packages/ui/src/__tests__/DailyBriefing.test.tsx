import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { DailyBriefing } from "../DailyBriefing";

function renderBriefing() {
  return render(
    <DailyBriefing
      content={"- First bullet\n- Second bullet"}
      hasAI={true}
      onDismiss={() => {}}
    />,
  );
}

describe("DailyBriefing", () => {
  it("renders without fade-in entry animation classes (appears instantly for Today-section consistency)", () => {
    const { container } = renderBriefing();
    const root = container.firstChild as HTMLElement;
    expect(root).toBeTruthy();
    // No opacity-0 / translate-y-4 staggered entry — all Today sections appear together.
    expect(root.className).not.toContain("opacity-0");
    expect(root.className).not.toContain("translate-y-4");
    // No transform transition on the container either
    expect(root.className).not.toContain("transition-all");
  });
});
