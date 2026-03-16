export function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function generateId(): string {
  return crypto.randomUUID();
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Convert a string to a URL-safe slug (lowercase, hyphens, preserves emoji and unicode) */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/[^\p{L}\p{N}\p{Emoji_Presentation}\p{Emoji}\u200d-]/gu, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}
