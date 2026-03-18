import { describe, it, expect } from "vitest";
import { isSafeUrl } from "../index";

describe("isSafeUrl", () => {
  it("accepts https:// URLs", () => {
    expect(isSafeUrl("https://example.com")).toBe(true);
  });

  it("accepts http:// URLs", () => {
    expect(isSafeUrl("http://example.com")).toBe(true);
  });

  it("rejects javascript:alert(1)", () => {
    expect(isSafeUrl("javascript:alert(1)")).toBe(false);
  });

  it("rejects javascript:fetch('https://evil.com')", () => {
    expect(isSafeUrl("javascript:fetch('https://evil.com')")).toBe(false);
  });

  it("rejects data: URLs", () => {
    expect(isSafeUrl("data:text/html,<script>")).toBe(false);
  });

  it("rejects ftp:// URLs", () => {
    expect(isSafeUrl("ftp://example.com")).toBe(false);
  });

  it("rejects empty string", () => {
    expect(isSafeUrl("")).toBe(false);
  });

  it("rejects malformed URL", () => {
    expect(isSafeUrl("not a url at all")).toBe(false);
  });

  it("accepts Google Meet links", () => {
    expect(isSafeUrl("https://meet.google.com/abc-def")).toBe(true);
  });

  it("accepts Zoom links", () => {
    expect(isSafeUrl("https://zoom.us/j/123")).toBe(true);
  });
});
