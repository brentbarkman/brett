import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SimpleMarkdown } from "../SimpleMarkdown";

// Helper to get all text content from a rendered SimpleMarkdown
function renderText(content: string) {
  const { container } = render(<SimpleMarkdown content={content} />);
  return container.textContent ?? "";
}

// Helper to render with click handlers
function renderWithHandlers(content: string) {
  const onItemClick = vi.fn();
  const onNavigate = vi.fn();
  const result = render(
    <SimpleMarkdown content={content} onItemClick={onItemClick} onNavigate={onNavigate} />
  );
  return { ...result, onItemClick, onNavigate };
}

describe("SimpleMarkdown", () => {
  // ── Basic rendering ──

  it("renders plain text", () => {
    expect(renderText("Hello world")).toBe("Hello world");
  });

  it("renders null for empty content", () => {
    const { container } = render(<SimpleMarkdown content="" />);
    expect(container.innerHTML).toBe("");
  });

  it("renders multiple lines", () => {
    const { container } = render(<SimpleMarkdown content={"Line 1\nLine 2\nLine 3"} />);
    expect(container.textContent).toContain("Line 1");
    expect(container.textContent).toContain("Line 2");
    expect(container.textContent).toContain("Line 3");
  });

  // ── Bold ──

  it("renders **bold** text", () => {
    const { container } = render(<SimpleMarkdown content="This is **bold** text" />);
    const strong = container.querySelector("strong");
    expect(strong).not.toBeNull();
    expect(strong!.textContent).toBe("bold");
  });

  it("renders multiple bold segments", () => {
    const { container } = render(<SimpleMarkdown content="**one** and **two**" />);
    const strongs = container.querySelectorAll("strong");
    expect(strongs).toHaveLength(2);
  });

  // ── Italic ──

  it("renders *italic* text", () => {
    const { container } = render(<SimpleMarkdown content="This is *italic* text" />);
    const em = container.querySelector("em");
    expect(em).not.toBeNull();
    expect(em!.textContent).toBe("italic");
  });

  // ── Strikethrough ──

  it("renders ~~strikethrough~~ text", () => {
    const { container } = render(<SimpleMarkdown content="This is ~~done~~ text" />);
    const strike = container.querySelector(".line-through");
    expect(strike).not.toBeNull();
    expect(strike!.textContent).toBe("done");
  });

  // ── Code ──

  it("renders `code` inline", () => {
    const { container } = render(<SimpleMarkdown content="Run `npm install`" />);
    const code = container.querySelector("code");
    expect(code).not.toBeNull();
    expect(code!.textContent).toBe("npm install");
  });

  // ── Headers ──

  it("renders # h1 headers", () => {
    expect(renderText("# Big Header")).toBe("Big Header");
  });

  it("renders ## h2 headers", () => {
    expect(renderText("## Medium Header")).toBe("Medium Header");
  });

  it("renders ### h3 headers", () => {
    expect(renderText("### Small Header")).toBe("Small Header");
  });

  // ── Lists ──

  it("renders bullet points with •", () => {
    const { container } = render(<SimpleMarkdown content={"- Item one\n- Item two"} />);
    const bullets = container.querySelectorAll(".pl-1");
    expect(bullets).toHaveLength(2);
    expect(container.textContent).toContain("Item one");
    expect(container.textContent).toContain("Item two");
  });

  it("renders numbered lists", () => {
    const { container } = render(<SimpleMarkdown content="1. First\n2. Second" />);
    expect(container.textContent).toContain("First");
    expect(container.textContent).toContain("Second");
  });

  // ── brett-item: links ──

  it("renders brett-item: links as clickable buttons", () => {
    const { onItemClick } = renderWithHandlers("[My Task](brett-item:abc123)");
    const button = screen.getByText("My Task");
    expect(button.tagName).toBe("BUTTON");
    fireEvent.click(button);
    expect(onItemClick).toHaveBeenCalledWith("abc123");
  });

  it("handles UUID IDs with hyphens in brett-item: links", () => {
    const { onItemClick } = renderWithHandlers(
      "[Send proposal](brett-item:8ed04d6c-d303-4957-9b47-e1e1f4dbedc9)"
    );
    const button = screen.getByText("Send proposal");
    fireEvent.click(button);
    expect(onItemClick).toHaveBeenCalledWith("8ed04d6c-d303-4957-9b47-e1e1f4dbedc9");
  });

  it("handles cuid IDs in brett-item: links", () => {
    const { onItemClick } = renderWithHandlers("[Task](brett-item:cM1LkR9xPqZ2abc)");
    const button = screen.getByText("Task");
    fireEvent.click(button);
    expect(onItemClick).toHaveBeenCalledWith("cM1LkR9xPqZ2abc");
  });

  it("renders brett-item: as styled span without onItemClick", () => {
    const { container } = render(<SimpleMarkdown content="[Task](brett-item:abc123)" />);
    const span = container.querySelector("span.text-blue-400");
    expect(span).not.toBeNull();
    expect(span!.textContent).toBe("Task");
  });

  // ── brett-event: links ──

  it("renders brett-event: links as clickable buttons", () => {
    const onEventClick = vi.fn();
    render(
      <SimpleMarkdown
        content="[Call w/ Leigh & Wendy](brett-event:8ed04d6c-d303-4957-9b47-e1e1f4dbedc9)"
        onEventClick={onEventClick}
      />
    );
    const button = screen.getByText("Call w/ Leigh & Wendy");
    expect(button.tagName).toBe("BUTTON");
    fireEvent.click(button);
    expect(onEventClick).toHaveBeenCalledWith("8ed04d6c-d303-4957-9b47-e1e1f4dbedc9");
  });

  it("renders brett-event: as styled span without onEventClick", () => {
    const { container } = render(
      <SimpleMarkdown content="[Meeting](brett-event:abc123)" />
    );
    const span = container.querySelector("span.text-blue-400");
    expect(span).not.toBeNull();
    expect(span!.textContent).toBe("Meeting");
    // No raw markdown visible
    expect(container.textContent).not.toContain("brett-event:");
  });

  // ── brett-nav: links ──

  it("renders brett-nav: links as clickable buttons", () => {
    const { onNavigate } = renderWithHandlers("[Today](brett-nav:/today)");
    const button = screen.getByText("Today");
    fireEvent.click(button);
    expect(onNavigate).toHaveBeenCalledWith("/today");
  });

  it("handles paths with slugs in brett-nav: links", () => {
    const { onNavigate } = renderWithHandlers("[Work List](brett-nav:/lists/work-tasks)");
    const button = screen.getByText("Work List");
    fireEvent.click(button);
    expect(onNavigate).toHaveBeenCalledWith("/lists/work-tasks");
  });

  // ── Generic markdown links (catch-all) ──

  it("strips generic markdown links and shows text only", () => {
    const text = renderText("[Call w/ Leigh & Wendy](https://example.com)");
    expect(text).toBe("Call w/ Leigh & Wendy");
    expect(text).not.toContain("https://");
    expect(text).not.toContain("[");
    expect(text).not.toContain("]");
    expect(text).not.toContain("(");
  });

  it("strips LLM-invented link formats", () => {
    const text = renderText("[Meeting Notes](brett:meetingNotes/abc123?ts=2026)");
    expect(text).toBe("Meeting Notes");
    expect(text).not.toContain("brett:");
  });

  it("strips arbitrary URL schemes", () => {
    const text = renderText("[Click here](custom-scheme://foo/bar)");
    expect(text).toBe("Click here");
  });

  it("handles & in link text", () => {
    const text = renderText("[Leigh & Wendy](some-url)");
    expect(text).toBe("Leigh & Wendy");
  });

  it("handles special characters in link text", () => {
    const text = renderText("[Q2 Budget: $1.2M — Final](some-url)");
    expect(text).toBe("Q2 Budget: $1.2M — Final");
  });

  // ── Mixed formatting ──

  it("handles bold inside bullet points", () => {
    const { container } = render(<SimpleMarkdown content="- **Important** task" />);
    const strong = container.querySelector("strong");
    expect(strong).not.toBeNull();
    expect(strong!.textContent).toBe("Important");
  });

  it("handles brett-item: link inside bullet points", () => {
    const { onItemClick } = renderWithHandlers("- [My Task](brett-item:abc123) is due");
    const button = screen.getByText("My Task");
    fireEvent.click(button);
    expect(onItemClick).toHaveBeenCalledWith("abc123");
  });

  it("handles multiple links on one line", () => {
    const { onItemClick } = renderWithHandlers(
      "[Task A](brett-item:id1) and [Task B](brett-item:id2)"
    );
    fireEvent.click(screen.getByText("Task A"));
    expect(onItemClick).toHaveBeenCalledWith("id1");
    fireEvent.click(screen.getByText("Task B"));
    expect(onItemClick).toHaveBeenCalledWith("id2");
  });

  it("handles strikethrough with brett-item: link inside (recursive)", () => {
    // ~~[Task](brett-item:id)~~ — strikethrough wraps the link, inner link still rendered
    const { container, onItemClick } = renderWithHandlers("~~[Done Task](brett-item:abc)~~");
    const strike = container.querySelector(".line-through");
    expect(strike).not.toBeNull();
    // The link inside strikethrough should still be clickable
    const button = strike!.querySelector("button");
    expect(button).not.toBeNull();
    expect(button!.textContent).toBe("Done Task");
    fireEvent.click(button!);
    expect(onItemClick).toHaveBeenCalledWith("abc");
  });

  it("handles bold and links on the same line", () => {
    const { container } = render(
      <SimpleMarkdown content="**Action items from Meeting** (2026-03-27): [Task](brett-item:abc)" />
    );
    expect(container.querySelector("strong")!.textContent).toBe("Action items from Meeting");
    expect(container.textContent).toContain("Task");
  });

  // ── Edge cases ──

  it("does not crash on unmatched markdown syntax", () => {
    expect(renderText("This has ** unmatched bold")).toBe("This has ** unmatched bold");
    expect(renderText("This has * unmatched italic")).toBe("This has * unmatched italic");
    expect(renderText("This has ~~ unmatched strike")).toBe("This has ~~ unmatched strike");
  });

  it("does not crash on empty brackets", () => {
    expect(renderText("[](brett-item:abc)")).toContain("");
  });

  it("handles consecutive formatting", () => {
    const text = renderText("**bold** then *italic* then `code`");
    expect(text).toContain("bold");
    expect(text).toContain("italic");
    expect(text).toContain("code");
  });

  // ── Real-world LLM outputs ──

  it("renders a typical action items response", () => {
    const content = `**Action items from Brent x Dan: Sync** (2026-03-27):

- [Send revised timeline](brett-item:8ed04d6c-d303-4957-9b47-e1e1f4dbedc9) (due 2026-03-28)
- [Follow up: Dan to complete migration](brett-item:abc123def456)
- ~~[Update timeline](brett-item:done-task-id)~~ (due 2026-03-27)

_Also found: **Brent / Daniel** (2026-03-20)_`;

    const { container, onItemClick } = renderWithHandlers(content);

    // Bold title renders
    expect(container.querySelector("strong")!.textContent).toBe("Action items from Brent x Dan: Sync");

    // Clickable links
    const sendButton = screen.getByText("Send revised timeline");
    expect(sendButton.tagName).toBe("BUTTON");
    fireEvent.click(sendButton);
    expect(onItemClick).toHaveBeenCalledWith("8ed04d6c-d303-4957-9b47-e1e1f4dbedc9");

    // Raw markdown syntax never shows
    expect(container.textContent).not.toContain("[Send revised");
    expect(container.textContent).not.toContain("](brett-item:");
  });

  it("renders a search_things meeting result with clickable title and summary", () => {
    const content = `[Call w/ Leigh & Wendy](brett-event:event-uuid-1) (2026-03-23):

Leigh mentioned that Darryl's comp at $2.265M isn't an ideal comparison.

**Tasks:**
- [Follow up: Leigh to send comps](brett-item:task-uuid-1)
- [Review appraisal report](brett-item:task-uuid-2) (due 2026-03-25)`;

    const onItemClick = vi.fn();
    const onEventClick = vi.fn();
    const { container } = render(
      <SimpleMarkdown content={content} onItemClick={onItemClick} onEventClick={onEventClick} />
    );

    // Meeting title is clickable event link
    const titleButton = screen.getByText("Call w/ Leigh & Wendy");
    expect(titleButton.tagName).toBe("BUTTON");
    fireEvent.click(titleButton);
    expect(onEventClick).toHaveBeenCalledWith("event-uuid-1");

    // Summary content is present
    expect(container.textContent).toContain("Leigh mentioned");
    expect(container.textContent).toContain("$2.265M");

    // Tasks are clickable
    fireEvent.click(screen.getByText("Follow up: Leigh to send comps"));
    expect(onItemClick).toHaveBeenCalledWith("task-uuid-1");

    // No raw markdown syntax visible
    expect(container.textContent).not.toContain("](");
    expect(container.textContent).not.toContain("brett-item:");
    expect(container.textContent).not.toContain("brett-event:");
  });

  it("strips LLM-hallucinated link formats cleanly", () => {
    // LLM sometimes invents link formats like brett:meetingNotes/...
    const content = `Found notes from [Call w/ Leigh & Wendy](brett:meetingNotes/abc?date=2026-03-23) on March 23rd.`;
    const text = renderText(content);

    expect(text).toContain("Call w/ Leigh & Wendy");
    expect(text).toContain("on March 23rd");
    expect(text).not.toContain("[");
    expect(text).not.toContain("](");
    expect(text).not.toContain("brett:");
  });
});
