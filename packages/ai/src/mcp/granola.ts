import type { MCPClient } from "./client.js";

export class GranolaMCPClient implements MCPClient {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  async query(resource: string, params: Record<string, unknown>): Promise<unknown> {
    // For now, this is a placeholder that returns null
    // Real implementation will connect to Granola's MCP server
    console.log(`[MCP/Granola] Query: ${resource}`, params);
    return null;
  }

  async getMeetingNotes(date: string, attendees?: string[]): Promise<string | null> {
    try {
      const result = await this.query("meeting_notes", { date, attendees });
      return result as string | null;
    } catch {
      return null;
    }
  }
}

// Factory that creates a Granola client if configured
export function createGranolaClient(): GranolaMCPClient | null {
  const url = process.env.GRANOLA_MCP_URL;
  if (!url) return null;
  return new GranolaMCPClient(url);
}
