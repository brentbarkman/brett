import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { prisma } from "./prisma.js";
import { decryptToken, encryptToken } from "./encryption.js";
import { ensureClientRegistered, clearRegisteredClient } from "../routes/granola-auth.js";

const GRANOLA_MCP_URL = "https://mcp.granola.ai/mcp";

// Per-account mutex to prevent concurrent token refreshes
const refreshLocks = new Map<string, Promise<void>>();

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

      return createMCPClient(newTokens.access_token);
    } finally {
      refreshLocks.delete(granolaAccountId);
      resolveRefresh!();
    }
  }

  const accessToken = decryptToken(account.accessToken);
  return createMCPClient(accessToken);
}

function createMCPClient(accessToken: string): Client {
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

  // Note: caller must call client.connect(transport) before using
  (client as any)._transport = transport;
  return client;
}

async function connectClient(client: Client): Promise<void> {
  const transport = (client as any)._transport;
  await client.connect(transport);
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

  let resp = await fetch("https://mcp-auth.granola.ai/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
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
  await connectClient(client);
  try {
    const tools: GranolaTools = {
      async listMeetings(timeRange, customStart?, customEnd?) {
        const args: Record<string, string> = { time_range: timeRange };
        if (timeRange === "custom" && customStart) args.custom_start = customStart;
        if (timeRange === "custom" && customEnd) args.custom_end = customEnd;
        const result = await client.callTool({ name: "list_meetings", arguments: args });
        return (result.content as any)?.[0]?.text
          ? JSON.parse((result.content as any)[0].text)
          : [];
      },
      async getMeetings(meetingIds) {
        const batches: string[][] = [];
        for (let i = 0; i < meetingIds.length; i += 10) {
          batches.push(meetingIds.slice(i, i + 10));
        }
        const results: GranolaMeetingDetail[] = [];
        for (const batch of batches) {
          const result = await client.callTool({
            name: "get_meetings",
            arguments: { meeting_ids: batch },
          });
          const parsed = (result.content as any)?.[0]?.text
            ? JSON.parse((result.content as any)[0].text)
            : [];
          results.push(...parsed);
        }
        return results;
      },
      async getTranscript(meetingId) {
        const result = await client.callTool({
          name: "get_meeting_transcript",
          arguments: { meeting_id: meetingId },
        });
        const text = (result.content as any)?.[0]?.text;
        return text ? JSON.parse(text) : null;
      },
      async query(q, documentIds?) {
        const args: Record<string, unknown> = { query: q };
        if (documentIds?.length) args.document_ids = documentIds;
        const result = await client.callTool({
          name: "query_granola_meetings",
          arguments: args,
        });
        return (result.content as any)?.[0]?.text ?? "";
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
