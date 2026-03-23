import path from "node:path";

/**
 * Sanitize a filename for safe storage and filesystem use.
 * Strips path traversal, control characters, and unsafe characters.
 */
export function sanitizeFilename(raw: string): string {
  // Extract basename, strip path traversal
  let name = path.basename(raw);
  // Remove null bytes and control characters
  name = name.replace(/[\x00-\x1f\x7f]/g, "");
  // Replace any remaining path separators (Windows)
  name = name.replace(/[/\\]/g, "_");
  // Replace other unsafe characters
  name = name.replace(/[^a-zA-Z0-9._-]/g, "_");
  // Collapse consecutive underscores
  name = name.replace(/_{2,}/g, "_");
  // Enforce max length
  if (name.length > 255) name = name.slice(0, 255);
  // Fallback if empty after sanitization
  return name || "unnamed";
}
