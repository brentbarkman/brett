import { describe, it, expect } from "vitest";
import { chunkText, estimateTokens } from "../embedding/chunker.js";

describe("estimateTokens", () => {
  it("estimates ~1 token per 4 chars", () => {
    expect(estimateTokens("hello world")).toBe(3); // 11 chars / 4 ≈ 3
  });

  it("returns 0 for empty string", () => {
    expect(estimateTokens("")).toBe(0);
  });
});

describe("chunkText", () => {
  it("returns single chunk for short text", () => {
    const text = "This is a short paragraph.";
    const chunks = chunkText(text);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toBe(text);
  });

  it("splits on paragraph boundaries", () => {
    const para = "Word ".repeat(400); // ~400 tokens
    const text = `${para}\n\n${para}`;
    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
  });

  it("splits long paragraphs on sentence boundaries", () => {
    const sentence = "This is a test sentence about financial planning. ";
    const longPara = sentence.repeat(100); // one giant paragraph
    const chunks = chunkText(longPara);
    expect(chunks.length).toBeGreaterThan(1);
    chunks.forEach((chunk) => {
      expect(estimateTokens(chunk)).toBeLessThanOrEqual(600); // some tolerance for overlap
    });
  });

  it("adds overlap between chunks", () => {
    const para = "Unique content block number one. ".repeat(80);
    const text = `${para}\n\n${para}`;
    const chunks = chunkText(text);
    if (chunks.length >= 2) {
      // Last portion of chunk N should appear at start of chunk N+1
      const endOfFirst = chunks[0].slice(-50);
      expect(chunks[1]).toContain(endOfFirst.trim().split(" ").slice(-3).join(" "));
    }
  });

  it("handles empty input", () => {
    expect(chunkText("")).toEqual([]);
  });

  it("handles text with no paragraph breaks", () => {
    const text = "word ".repeat(1000);
    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThan(1);
  });

  it("respects maxTextLength per chunk", () => {
    const text = "a".repeat(20000);
    const chunks = chunkText(text);
    chunks.forEach((chunk) => {
      expect(chunk.length).toBeLessThanOrEqual(8000);
    });
  });
});
