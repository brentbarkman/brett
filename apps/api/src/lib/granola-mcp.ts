import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { prisma } from "./prisma.js";
import { decryptToken, encryptToken } from "./encryption.js";
import { ensureClientRegistered, clearRegisteredClient } from "../routes/granola-auth.js";

const GRANOLA_MCP_URL = "https://mcp.granola.ai/mcp";

// Per-account mutex to prevent concurrent token refreshes
const refreshLocks = new Map<string, Promise<void>>();

// ── Response parsers ──
// Granola MCP returns XML-like text, not JSON. Parse it with regex.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractTextContent(result: any): string {
  const content = result?.content;
  if (Array.isArray(content) && content[0]?.type === "text") {
    return content[0].text as string;
  }
  return "";
}

function parseMeetingList(text: string): GranolaMeetingListItem[] {
  const meetings: GranolaMeetingListItem[] = [];
  const meetingRegex = /<meeting\s+id="([^"]+)"\s+title="([^"]+)"\s+date="([^"]+)">/g;
  const participantRegex = /<known_participants>\s*([\s\S]*?)\s*<\/known_participants>/g;

  let match;
  const participantBlocks: string[] = [];
  let pMatch;
  while ((pMatch = participantRegex.exec(text)) !== null) {
    participantBlocks.push(pMatch[1]);
  }

  let idx = 0;
  while ((match = meetingRegex.exec(text)) !== null) {
    const attendees: { name: string; email: string }[] = [];
    const block = participantBlocks[idx] ?? "";
    const emailRegex = /([^,<]+?)\s*<([^>]+)>/g;
    let eMatch;
    while ((eMatch = emailRegex.exec(block)) !== null) {
      attendees.push({
        name: eMatch[1].trim().replace(/\s+from\s+\S+$/i, ""),
        email: eMatch[2].trim(),
      });
    }

    meetings.push({
      id: match[1],
      title: match[2],
      start_time: new Date(match[3]).toISOString(),
      end_time: new Date(match[3]).toISOString(), // Granola list doesn't provide end time
      attendees,
    });
    idx++;
  }
  return meetings;
}

function parseMeetingDetails(text: string): GranolaMeetingDetail[] {
  // get_meetings returns XML with <meeting> blocks containing <summary> tags
  const meetings: GranolaMeetingDetail[] = [];
  const meetingRegex = /<meeting\s+id="([^"]+)"\s+title="([^"]+)"\s+date="([^"]+)">/g;
  const summaryRegex = /<summary>\s*([\s\S]*?)\s*<\/summary>/g;

  // Extract all summaries in order
  const summaries: string[] = [];
  let sMatch;
  while ((sMatch = summaryRegex.exec(text)) !== null) {
    summaries.push(sMatch[1].trim());
  }

  let idx = 0;
  let match;
  while ((match = meetingRegex.exec(text)) !== null) {
    meetings.push({
      id: match[1],
      title: match[2],
      start_time: new Date(match[3]).toISOString(),
      end_time: new Date(match[3]).toISOString(),
      summary: summaries[idx] ?? null,
      notes: summaries[idx] ?? null,
      attendees: [],
    });
    idx++;
  }
  return meetings;
}

function parseTranscript(text: string): GranolaTranscript | null {
  if (!text.trim()) return null;

  // Granola returns JSON: {id, title, transcript: "long text"}
  try {
    const parsed = JSON.parse(text);
    if (parsed.transcript && typeof parsed.transcript === "string") {
      // Single block of text — store as one turn
      return {
        turns: [{
          source: "speaker",
          speaker: "Transcript",
          text: parsed.transcript.trim(),
        }],
      };
    }
  } catch {
    // Not JSON — fall through to line-based parsing
  }

  // Fallback: line-based "Speaker: text" parsing
  const turns: { source: string; speaker: string; text: string }[] = [];
  const lines = text.split("\n").filter((l) => l.trim());
  for (const line of lines) {
    const colonIdx = line.indexOf(":");
    if (colonIdx > 0 && colonIdx < 50) {
      turns.push({
        source: "speaker",
        speaker: line.slice(0, colonIdx).trim(),
        text: line.slice(colonIdx + 1).trim(),
      });
    }
  }
  return turns.length > 0 ? { turns } : null;
}

interface GranolaMeetingListItem {
  id: string;
  title: string;
  start_time: string;
  end_time: string;
  attendees?: { name: string; email: string }[];
}

interface GranolaMeetingDetail {
  id: string;
  title: string;
  start_time: string;
  end_time: string;
  notes?: string;
  summary?: string;
  attendees?: { name: string; email: string }[];
}

interface GranolaTranscript {
  turns: { source: string; speaker: string; text: string }[];
}

/**
 * Create an authenticated MCP client for a Granola account.
 * Handles token refresh if the access token has expired.
 * Uses a per-account mutex to prevent concurrent refresh races.
 */
async function getGranolaClient(granolaAccountId: string): Promise<Client> {
  // Wait for any in-progress refresh for this account
  const existing = refreshLocks.get(granolaAccountId);
  if (existing) await existing;

  const account = await prisma.granolaAccount.findUniqueOrThrow({
    where: { id: granolaAccountId },
  });

  // Check if token needs refresh
  if (account.tokenExpiresAt < new Date()) {
    let resolveRefresh: () => void;
    const lockPromise = new Promise<void>((resolve) => { resolveRefresh = resolve; });
    refreshLocks.set(granolaAccountId, lockPromise);

    try {
      const refreshToken = decryptToken(account.refreshToken);
      const newTokens = await refreshGranolaTokens(refreshToken);

      await prisma.granolaAccount.update({
        where: { id: granolaAccountId },
        data: {
          accessToken: encryptToken(newTokens.access_token),
          refreshToken: newTokens.refresh_token
            ? encryptToken(newTokens.refresh_token)
            : account.refreshToken,
          tokenExpiresAt: new Date(Date.now() + newTokens.expires_in * 1000),
        },
      });

      return createAndConnectClient(newTokens.access_token);
    } finally {
      refreshLocks.delete(granolaAccountId);
      resolveRefresh!();
    }
  }

  const accessToken = decryptToken(account.accessToken);
  return createAndConnectClient(accessToken);
}

/**
 * Create and connect an MCP client in one step.
 * The SDK requires connect() to be called exactly once per Client instance.
 */
async function createAndConnectClient(accessToken: string): Promise<Client> {
  const client = new Client({ name: "brett", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(
    new URL(GRANOLA_MCP_URL),
    {
      requestInit: {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
    },
  );
  await client.connect(transport);
  return client;
}

async function refreshGranolaTokens(refreshToken: string): Promise<{
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}> {
  const client = await ensureClientRegistered();
  const params: Record<string, string> = {
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: client.client_id,
  };
  if (client.client_secret) {
    params.client_secret = client.client_secret;
  }

  // Bounded timeout — Granola's OAuth endpoint normally responds in <1s.
  // Without this, a Granola outage would hang every MCP-dependent
  // background job indefinitely.
  let resp = await fetch("https://mcp-auth.granola.ai/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
    signal: AbortSignal.timeout(10_000),
  });

  // If 401, client creds may be stale — re-register and retry once
  if (resp.status === 401) {
    clearRegisteredClient();
    const freshClient = await ensureClientRegistered();
    params.client_id = freshClient.client_id;
    if (freshClient.client_secret) {
      params.client_secret = freshClient.client_secret;
    } else {
      delete params.client_secret;
    }
    resp = await fetch("https://mcp-auth.granola.ai/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params),
      signal: AbortSignal.timeout(10_000),
    });
  }

  if (!resp.ok) {
    throw new Error(`Token refresh failed: ${resp.status}`);
  }

  return resp.json();
}

// ── Public API ──

export interface GranolaTools {
  listMeetings: (
    timeRange: "this_week" | "last_week" | "last_30_days" | "custom",
    customStart?: string,
    customEnd?: string,
  ) => Promise<GranolaMeetingListItem[]>;
  getMeetings: (meetingIds: string[]) => Promise<GranolaMeetingDetail[]>;
  getTranscript: (meetingId: string) => Promise<GranolaTranscript | null>;
  query: (query: string, documentIds?: string[]) => Promise<string>;
}

/**
 * Create a single MCP client for a batch of operations, avoiding
 * multiple connect/close cycles.
 */
export async function withGranolaClient<T>(
  granolaAccountId: string,
  fn: (tools: GranolaTools) => Promise<T>,
): Promise<T> {
  const client = await getGranolaClient(granolaAccountId);
  // Client is already connected by getGranolaClient -> createAndConnectClient
  try {
    const tools: GranolaTools = {
      async listMeetings(timeRange, customStart?, customEnd?) {
        const args: Record<string, string> = { time_range: timeRange };
        if (timeRange === "custom" && customStart) args.custom_start = customStart;
        if (timeRange === "custom" && customEnd) args.custom_end = customEnd;
        const result = await client.callTool({ name: "list_meetings", arguments: args });
        const text = extractTextContent(result);
        return parseMeetingList(text);
      },
      async getMeetings(meetingIds) {
        // get_meetings returns detailed notes per meeting
        const results: GranolaMeetingDetail[] = [];
        const batches: string[][] = [];
        for (let i = 0; i < meetingIds.length; i += 10) {
          batches.push(meetingIds.slice(i, i + 10));
        }
        for (const batch of batches) {
          const result = await client.callTool({
            name: "get_meetings",
            arguments: { meeting_ids: batch },
          });
          const text = extractTextContent(result);
          const parsed = parseMeetingDetails(text);
          results.push(...parsed);
        }
        return results;
      },
      async getTranscript(meetingId) {
        const result = await client.callTool({
          name: "get_meeting_transcript",
          arguments: { meeting_id: meetingId },
        });
        const text = extractTextContent(result);
        return parseTranscript(text);
      },
      async query(q, documentIds?) {
        const args: Record<string, unknown> = { query: q };
        if (documentIds?.length) args.document_ids = documentIds;
        const result = await client.callTool({
          name: "query_granola_meetings",
          arguments: args,
        });
        return extractTextContent(result);
      },
    };
    return await fn(tools);
  } finally {
    await client.close();
  }
}

export async function listGranolaMeetings(
  granolaAccountId: string,
  timeRange: "this_week" | "last_week" | "last_30_days" | "custom",
  customStart?: string,
  customEnd?: string,
): Promise<GranolaMeetingListItem[]> {
  return withGranolaClient(granolaAccountId, (tools) =>
    tools.listMeetings(timeRange, customStart, customEnd),
  );
}

export async function getGranolaMeetings(
  granolaAccountId: string,
  meetingIds: string[],
): Promise<GranolaMeetingDetail[]> {
  return withGranolaClient(granolaAccountId, (tools) =>
    tools.getMeetings(meetingIds),
  );
}

export async function getGranolaTranscript(
  granolaAccountId: string,
  meetingId: string,
): Promise<GranolaTranscript | null> {
  return withGranolaClient(granolaAccountId, (tools) =>
    tools.getTranscript(meetingId),
  );
}

export async function queryGranolaMeetings(
  granolaAccountId: string,
  query: string,
  documentIds?: string[],
): Promise<string> {
  return withGranolaClient(granolaAccountId, (tools) =>
    tools.query(query, documentIds),
  );
}
