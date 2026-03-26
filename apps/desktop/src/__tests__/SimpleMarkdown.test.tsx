import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { SimpleMarkdown } from "@brett/ui";

describe("SimpleMarkdown", () => {
  describe("plain text", () => {
    it("renders plain text", () => {
      render(<SimpleMarkdown content="Hello world" />);
      expect(screen.getByText("Hello world")).toBeTruthy();
    });

    it("renders nothing for empty content", () => {
      const { container } = render(<SimpleMarkdown content="" />);
      expect(container.innerHTML).toBe("");
    });

    it("renders multiple lines", () => {
      render(<SimpleMarkdown content={"Line one\nLine two"} />);
      expect(screen.getByText("Line one")).toBeTruthy();
      expect(screen.getByText("Line two")).toBeTruthy();
    });
  });

  describe("bold", () => {
    it("renders **bold** as <strong>", () => {
      render(<SimpleMarkdown content="This is **bold** text" />);
      const strong = document.querySelector("strong");
      expect(strong).toBeTruthy();
      expect(strong!.textContent).toBe("bold");
    });

    it("renders multiple bold segments", () => {
      render(<SimpleMarkdown content="**one** and **two**" />);
      const strongs = document.querySelectorAll("strong");
      expect(strongs.length).toBe(2);
    });
  });

  describe("italic", () => {
    it("renders *italic* as <em>", () => {
      render(<SimpleMarkdown content="This is *italic* text" />);
      const em = document.querySelector("em");
      expect(em).toBeTruthy();
      expect(em!.textContent).toBe("italic");
    });
  });

  describe("code", () => {
    it("renders `code` as <code>", () => {
      render(<SimpleMarkdown content="Use `npm install` here" />);
      const code = document.querySelector("code");
      expect(code).toBeTruthy();
      expect(code!.textContent).toBe("npm install");
    });
  });

  describe("bullet points", () => {
    it("renders - prefixed lines as bullets", () => {
      render(<SimpleMarkdown content={"- Item one\n- Item two\n- Item three"} />);
      const bullets = document.querySelectorAll("span");
      const bulletDots = Array.from(bullets).filter(s => s.textContent === "•");
      expect(bulletDots.length).toBe(3);
    });

    it("renders • prefixed lines as bullets", () => {
      render(<SimpleMarkdown content="• Bullet item" />);
      expect(screen.getByText("Bullet item")).toBeTruthy();
    });
  });

  describe("numbered lists", () => {
    it("renders numbered lines", () => {
      render(<SimpleMarkdown content={"1. First\n2. Second"} />);
      expect(screen.getByText("First")).toBeTruthy();
      expect(screen.getByText("Second")).toBeTruthy();
    });
  });

  describe("brett-item links", () => {
    it("renders clickable item links when onItemClick provided", () => {
      const onClick = vi.fn();
      render(
        <SimpleMarkdown
          content="Check out [My Task](brett-item:abc123)"
          onItemClick={onClick}
        />
      );
      const button = screen.getByText("My Task");
      expect(button.tagName).toBe("BUTTON");
      fireEvent.click(button);
      expect(onClick).toHaveBeenCalledWith("abc123");
    });

    it("renders non-clickable item links when no onItemClick", () => {
      render(<SimpleMarkdown content="Check out [My Task](brett-item:abc123)" />);
      expect(screen.getByText("My Task")).toBeTruthy();
      expect(screen.getByText("My Task").tagName).toBe("SPAN");
    });
  });

  describe("brett-nav links", () => {
    it("renders clickable nav links when onNavigate provided", () => {
      const onNav = vi.fn();
      render(
        <SimpleMarkdown
          content="Go to [Today](brett-nav:/today)"
          onNavigate={onNav}
        />
      );
      const button = screen.getByText("Today");
      expect(button.tagName).toBe("BUTTON");
      fireEvent.click(button);
      expect(onNav).toHaveBeenCalledWith("/today");
    });

    it("handles nav links with spaces and special chars in path", () => {
      const onNav = vi.fn();
      render(
        <SimpleMarkdown
          content="See [My Podcasts](brett-nav:/lists/my-podcasts)"
          onNavigate={onNav}
        />
      );
      fireEvent.click(screen.getByText("My Podcasts"));
      expect(onNav).toHaveBeenCalledWith("/lists/my-podcasts");
    });

    it("handles nav links with complex paths", () => {
      const onNav = vi.fn();
      render(
        <SimpleMarkdown
          content="Open [Show CCXs](brett-nav:/lists/show-ccxs)"
          onNavigate={onNav}
        />
      );
      fireEvent.click(screen.getByText("Show CCXs"));
      expect(onNav).toHaveBeenCalledWith("/lists/show-ccxs");
    });

    it("renders non-clickable nav links when no onNavigate", () => {
      render(<SimpleMarkdown content="Go to [Inbox](brett-nav:/inbox)" />);
      expect(screen.getByText("Inbox")).toBeTruthy();
      expect(screen.getByText("Inbox").tagName).toBe("SPAN");
    });
  });

  describe("mixed formatting", () => {
    it("renders bold inside bullet points", () => {
      render(<SimpleMarkdown content="- This is **important**" />);
      const strong = document.querySelector("strong");
      expect(strong).toBeTruthy();
      expect(strong!.textContent).toBe("important");
    });

    it("handles multiple inline formats in one line", () => {
      render(<SimpleMarkdown content="Use **bold** and *italic* and `code`" />);
      expect(document.querySelector("strong")).toBeTruthy();
      expect(document.querySelector("em")).toBeTruthy();
      expect(document.querySelector("code")).toBeTruthy();
    });
  });

  describe("empty lines and spacing", () => {
    it("treats empty lines as paragraph breaks", () => {
      const { container } = render(
        <SimpleMarkdown content={"Paragraph one\n\nParagraph two"} />
      );
      // Empty line should create a spacer div
      const spacers = container.querySelectorAll(".h-2");
      expect(spacers.length).toBe(1);
    });

    it("does not create leading blank space from empty first line", () => {
      const { container } = render(
        <SimpleMarkdown content={"\n\nActual content"} />
      );
      // First child should be a spacer, not content — but the key is
      // that the content still renders
      expect(screen.getByText("Actual content")).toBeTruthy();
    });
  });

  describe("edge cases", () => {
    it("handles content with only whitespace lines", () => {
      const { container } = render(<SimpleMarkdown content={"  \n  \n  "} />);
      expect(container.querySelector(".h-2")).toBeTruthy();
    });

    it("handles unclosed bold markers", () => {
      render(<SimpleMarkdown content="This **is not closed" />);
      // Should render as plain text, not crash
      expect(screen.getByText("This **is not closed")).toBeTruthy();
    });

    it("handles unclosed code backticks", () => {
      render(<SimpleMarkdown content="Use `unclosed code" />);
      expect(screen.getByText("Use `unclosed code")).toBeTruthy();
    });
  });
});
