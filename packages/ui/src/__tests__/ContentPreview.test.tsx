import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { ContentPreview } from "../ContentPreview";

function renderArticle(html: string) {
  const { container } = render(
    <ContentPreview
      contentType="article"
      contentStatus="extracted"
      contentBody={html}
    />
  );
  return container;
}

describe("ContentPreview article typography", () => {
  it("renders paragraphs with bottom margin", () => {
    const container = renderArticle("<p>First paragraph</p><p>Second paragraph</p>");
    const paragraphs = container.querySelectorAll("p");
    expect(paragraphs).toHaveLength(2);
    expect(paragraphs[0]!.textContent).toBe("First paragraph");
    expect(paragraphs[1]!.textContent).toBe("Second paragraph");
    // The parent div should have [&_p]:mb-4 which applies margin-bottom to <p> tags
    const articleDiv = paragraphs[0]!.parentElement!;
    expect(articleDiv.className).toContain("[&_p]:mb-4");
  });

  it("renders headings with appropriate styles", () => {
    const container = renderArticle("<h1>Title</h1><h2>Subtitle</h2><h3>Section</h3><p>Text</p>");
    expect(container.querySelector("h1")!.textContent).toBe("Title");
    expect(container.querySelector("h2")!.textContent).toBe("Subtitle");
    expect(container.querySelector("h3")!.textContent).toBe("Section");
    const articleDiv = container.querySelector("h1")!.parentElement!;
    expect(articleDiv.className).toContain("[&_h1]:text-lg");
    expect(articleDiv.className).toContain("[&_h2]:text-base");
    expect(articleDiv.className).toContain("[&_h3]:text-sm");
  });

  it("renders lists with proper formatting classes", () => {
    const container = renderArticle("<ul><li>Item 1</li><li>Item 2</li></ul><ol><li>First</li></ol>");
    expect(container.querySelectorAll("li")).toHaveLength(3);
    const articleDiv = container.querySelector("ul")!.parentElement!;
    expect(articleDiv.className).toContain("[&_ul]:list-disc");
    expect(articleDiv.className).toContain("[&_ol]:list-decimal");
    expect(articleDiv.className).toContain("[&_li]:mb-1");
  });

  it("renders blockquotes with left border style", () => {
    const container = renderArticle("<blockquote>A quote</blockquote>");
    expect(container.querySelector("blockquote")!.textContent).toBe("A quote");
    const articleDiv = container.querySelector("blockquote")!.parentElement!;
    expect(articleDiv.className).toContain("[&_blockquote]:border-l-2");
    expect(articleDiv.className).toContain("[&_blockquote]:pl-3");
  });

  it("renders links with styling and target=_blank", () => {
    const container = renderArticle('<p>Visit <a href="https://example.com">here</a></p>');
    const link = container.querySelector("a");
    expect(link).not.toBeNull();
    expect(link!.textContent).toBe("here");
    expect(link!.getAttribute("target")).toBe("_blank");
    expect(link!.getAttribute("rel")).toBe("noopener noreferrer");
    const articleDiv = link!.parentElement!.parentElement!;
    expect(articleDiv.className).toContain("[&_a]:text-brett-gold");
  });

  it("strips video and source elements (no benefit from Readability content)", () => {
    const container = renderArticle(
      '<video controls><source src="https://example.com/video.mp4" type="video/mp4" /></video><p>Text</p>'
    );
    expect(container.querySelector("video")).toBeNull();
    expect(container.querySelector("source")).toBeNull();
    expect(container.textContent).toContain("Text");
  });

  it("strips class attribute to prevent Tailwind utility injection", () => {
    const container = renderArticle(
      '<p class="fixed inset-0 z-50 bg-black">Overlay attack</p>'
    );
    const p = container.querySelector("p")!;
    expect(p.getAttribute("class")).toBeNull();
    expect(p.textContent).toBe("Overlay attack");
  });

  it("sanitizes dangerous tags", () => {
    const container = renderArticle(
      '<p>Safe</p><script>alert("xss")</script><form><input /></form><iframe src="evil"></iframe>'
    );
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("form")).toBeNull();
    expect(container.querySelector("iframe")).toBeNull();
    expect(container.textContent).toContain("Safe");
  });

  it("sanitizes dangerous attributes", () => {
    const container = renderArticle(
      '<p style="color:red" onclick="alert(1)" onerror="alert(2)">Text</p>'
    );
    const p = container.querySelector("p")!;
    expect(p.getAttribute("style")).toBeNull();
    expect(p.getAttribute("onclick")).toBeNull();
    expect(p.getAttribute("onerror")).toBeNull();
  });

  it("renders code blocks with styling", () => {
    const container = renderArticle("<pre><code>const x = 1;</code></pre>");
    expect(container.querySelector("pre")).not.toBeNull();
    expect(container.querySelector("code")!.textContent).toBe("const x = 1;");
    const articleDiv = container.querySelector("pre")!.parentElement!;
    expect(articleDiv.className).toContain("[&_pre]:bg-white/5");
    expect(articleDiv.className).toContain("[&_code]:text-xs");
  });

  it("strips dead video play buttons from CNBC-style markup", () => {
    const container = renderArticle(
      '<p>Some text.</p><div data-test="PlayButton"><p><span>watch now</span></p></div><p>More text.</p>'
    );
    expect(container.textContent).not.toContain("watch now");
    expect(container.textContent).toContain("Some text.");
    expect(container.textContent).toContain("More text.");
  });

  it("strips WatchlistDropdown spans", () => {
    const container = renderArticle(
      '<p><a href="https://example.com">Stock</a><span id="-WatchlistDropdown" data-analytics-id="-WatchlistDropdown"></span></p>'
    );
    expect(container.querySelector("a")!.textContent).toBe("Stock");
    expect(container.innerHTML).not.toContain("WatchlistDropdown");
  });

  it("shows web page fallback when no article body", () => {
    const { container } = render(
      <ContentPreview
        contentType="article"
        contentStatus="extracted"
        contentTitle="Test Article"
        contentDescription="A description"
        sourceUrl="https://example.com"
      />
    );
    // Should render WebPagePreview fallback, not ArticlePreview
    expect(container.querySelector("h4")!.textContent).toBe("Test Article");
    expect(container.textContent).toContain("A description");
  });

  it("shows loading skeleton when pending", () => {
    const { container } = render(
      <ContentPreview contentType="article" contentStatus="pending" />
    );
    expect(container.textContent).toContain("Extracting content...");
  });

  it("shows error state when failed", () => {
    const { container } = render(
      <ContentPreview contentType="article" contentStatus="failed" sourceUrl="https://example.com" />
    );
    expect(container.textContent).toContain("Preview unavailable");
  });
});
