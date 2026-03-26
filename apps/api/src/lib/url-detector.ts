// Re-export from shared utils — single source of truth for URL content type detection.
// Used by content-extractor.ts and available to other packages (e.g. AI skills).
export { detectContentType } from "@brett/utils";
