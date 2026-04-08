/**
 * React 19 upgrade smoke tests.
 *
 * Purpose: verify that major components render without crashing after
 * the React 18 → 19 upgrade. These are NOT behavioral tests — they
 * only check that imports resolve and JSX renders without throwing.
 */
import { describe, it, expect, vi } from "vitest";
import React, { createRef } from "react";
import { render, screen } from "@testing-library/react";

describe("React 19 upgrade — smoke tests", () => {
  // ── @brett/ui components ────────────────────────────────────

  describe("Button (@brett/ui)", () => {
    it("renders without crashing", async () => {
      const { Button } = await import("@brett/ui");
      const { container } = render(<Button>Click me</Button>);
      expect(container.querySelector("button")).toBeTruthy();
      expect(screen.getByText("Click me")).toBeTruthy();
    });

    it("renders all variants", async () => {
      const { Button } = await import("@brett/ui");
      const { container } = render(
        <>
          <Button variant="primary">Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
        </>
      );
      expect(container.querySelectorAll("button").length).toBe(3);
    });
  });

  describe("SimpleMarkdown (@brett/ui)", () => {
    it("renders plain text", async () => {
      const { SimpleMarkdown } = await import("@brett/ui");
      render(<SimpleMarkdown content="Hello React 19" />);
      expect(screen.getByText("Hello React 19")).toBeTruthy();
    });

    it("renders formatted markdown", async () => {
      const { SimpleMarkdown } = await import("@brett/ui");
      render(<SimpleMarkdown content="This is **bold** and *italic*" />);
      expect(document.querySelector("strong")).toBeTruthy();
      expect(document.querySelector("em")).toBeTruthy();
    });
  });

  describe("BrettMark (@brett/ui)", () => {
    it("renders the default mark", async () => {
      const { BrettMark } = await import("@brett/ui");
      const { container } = render(<BrettMark />);
      expect(container.querySelector("svg")).toBeTruthy();
    });

    it("renders in thinking state", async () => {
      const { BrettMark } = await import("@brett/ui");
      const { container } = render(<BrettMark thinking />);
      expect(container.querySelector("svg")).toBeTruthy();
    });
  });

  describe("ProductMark (@brett/ui)", () => {
    it("renders without crashing", async () => {
      const { ProductMark } = await import("@brett/ui");
      const { container } = render(<ProductMark />);
      expect(container.querySelector("svg")).toBeTruthy();
    });
  });

  describe("CrossFade (@brett/ui)", () => {
    it("renders children", async () => {
      const { CrossFade } = await import("@brett/ui");
      render(
        <CrossFade stateKey="test">
          <span>Crossfade content</span>
        </CrossFade>
      );
      expect(screen.getByText("Crossfade content")).toBeTruthy();
    });
  });

  describe("ConfirmDialog (@brett/ui)", () => {
    it("renders title and description", async () => {
      const { ConfirmDialog } = await import("@brett/ui");
      render(
        <ConfirmDialog
          title="Delete item?"
          description="This cannot be undone."
          onConfirm={vi.fn()}
          onCancel={vi.fn()}
        />
      );
      expect(screen.getByText("Delete item?")).toBeTruthy();
      expect(screen.getByText("This cannot be undone.")).toBeTruthy();
    });
  });

  describe("Tooltip (@brett/ui)", () => {
    it("renders trigger children", async () => {
      const { Tooltip } = await import("@brett/ui");
      render(
        <Tooltip content="Helpful tip">
          <button>Hover me</button>
        </Tooltip>
      );
      expect(screen.getByText("Hover me")).toBeTruthy();
    });
  });

  describe("SkeletonBar and SkeletonListView (@brett/ui)", () => {
    it("renders skeleton bar", async () => {
      const { SkeletonBar } = await import("@brett/ui");
      const { container } = render(<SkeletonBar className="h-4 w-full" />);
      expect(container.firstChild).toBeTruthy();
    });

    it("renders skeleton list view", async () => {
      const { SkeletonListView } = await import("@brett/ui");
      const { container } = render(<SkeletonListView />);
      expect(container.firstChild).toBeTruthy();
    });
  });

  describe("FilterPills (@brett/ui)", () => {
    it("renders all filter options", async () => {
      const { FilterPills } = await import("@brett/ui");
      render(<FilterPills activeFilter="All" onSelectFilter={vi.fn()} />);
      expect(screen.getByText("All")).toBeTruthy();
      expect(screen.getByText("Tasks")).toBeTruthy();
      expect(screen.getByText("Content")).toBeTruthy();
    });
  });

  describe("SectionHeader (@brett/ui)", () => {
    it("renders title", async () => {
      const { SectionHeader } = await import("@brett/ui");
      render(<SectionHeader title="My Section" />);
      expect(screen.getByText("My Section")).toBeTruthy();
    });
  });

  // ── forwardRef → ref prop refactors ────────────────────────

  describe("QuickAddInput ref prop (@brett/ui)", () => {
    it("renders without crashing", async () => {
      const { QuickAddInput } = await import("@brett/ui");
      const { container } = render(<QuickAddInput onAdd={vi.fn()} />);
      expect(container.querySelector("input")).toBeTruthy();
    });

    it("accepts a ref and exposes focus()", async () => {
      const { QuickAddInput } = await import("@brett/ui");
      const ref = createRef<{ focus: () => void }>();
      render(<QuickAddInput ref={ref} onAdd={vi.fn()} />);
      expect(ref.current).toBeTruthy();
      expect(typeof ref.current!.focus).toBe("function");
    });
  });

  describe("VideoBackground ref prop", () => {
    it("renders without crashing", async () => {
      const { VideoBackground } = await import("../auth/VideoBackground");
      const { container } = render(
        <VideoBackground videos={["test1.mp4", "test2.mp4"]} />
      );
      expect(container.querySelectorAll("video").length).toBe(2);
    });

    it("accepts a ref and exposes skip()", async () => {
      const { VideoBackground } = await import("../auth/VideoBackground");
      const ref = createRef<{ skip: () => void }>();
      render(
        <VideoBackground ref={ref} videos={["test1.mp4", "test2.mp4"]} />
      );
      expect(ref.current).toBeTruthy();
      expect(typeof ref.current!.skip).toBe("function");
    });
  });
});
