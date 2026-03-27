/**
 * @deprecated Real Granola MCP client lives in apps/api/src/lib/granola-mcp.ts
 * This file is kept for backward compatibility with existing imports.
 * Skills now query the local DB directly instead of calling MCP.
 */

// No-op — skills use Prisma directly, MCP client is server-side only
export function createGranolaClient(): null {
  return null;
}
