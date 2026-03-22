import type { ContentType } from "@brett/types";
export { detectUrl } from "@brett/business";

const CONTENT_TYPE_PATTERNS: [RegExp, ContentType][] = [
  [/^https?:\/\/(www\.)?(x|twitter)\.com\/[^/]+\/article\//i, "article"],
  [/^https?:\/\/(www\.)?(x|twitter)\.com\/[^/]+\/status\//i, "tweet"],
  [/^https?:\/\/(www\.)?youtube\.com\/watch/i, "video"],
  [/^https?:\/\/(www\.)?youtu\.be\//i, "video"],
  [/^https?:\/\/open\.spotify\.com\/episode\//i, "podcast"],
  [/^https?:\/\/podcasts\.apple\.com\/.+\/podcast\//i, "podcast"],
  [/\.pdf(\?.*)?$/i, "pdf"],
  [/^https?:\/\/(www\.)?medium\.com\//i, "article"],
  [/^https?:\/\/[^/]+\.substack\.com\//i, "article"],
];

export function detectContentType(url: string): ContentType {
  for (const [pattern, type] of CONTENT_TYPE_PATTERNS) {
    if (pattern.test(url)) return type;
  }
  return "web_page";
}
