import { google, type drive_v3, type docs_v1 } from "googleapis";
import { decryptToken, encryptToken } from "./encryption.js";
import { prisma } from "./prisma.js";
import type { MeetingTranscriptTurn } from "@brett/types";

interface GoogleAccountInfo {
  id: string;
  accessToken: string;
  refreshToken: string;
}

/** Create a shared OAuth2 client with automatic token refresh persistence. */
function getAuthenticatedOAuth2Client(account: GoogleAccountInfo) {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
  );
  oauth2Client.setCredentials({
    access_token: decryptToken(account.accessToken),
    refresh_token: decryptToken(account.refreshToken),
  });

  // Persist refreshed tokens (same pattern as google-calendar.ts)
  oauth2Client.on("tokens", async (tokens) => {
    const updateData: Record<string, unknown> = {};
    if (tokens.access_token) {
      updateData.accessToken = encryptToken(tokens.access_token);
    }
    if (tokens.refresh_token) {
      console.log(`[google-drive] Refresh token rotated for account ${account.id}`);
      updateData.refreshToken = encryptToken(tokens.refresh_token);
    }
    if (tokens.expiry_date) {
      updateData.tokenExpiresAt = new Date(tokens.expiry_date);
    }
    if (Object.keys(updateData).length > 0) {
      await prisma.googleAccount.update({
        where: { id: account.id },
        data: updateData,
      }).catch((err) => {
        console.error(`[google-drive] Failed to persist refreshed tokens for ${account.id}:`, err);
      });
    }
  });

  return oauth2Client;
}

export function getDriveClient(account: GoogleAccountInfo): drive_v3.Drive {
  return google.drive({ version: "v3", auth: getAuthenticatedOAuth2Client(account) });
}

export function getDocsClient(account: GoogleAccountInfo): docs_v1.Docs {
  return google.docs({ version: "v1", auth: getAuthenticatedOAuth2Client(account) });
}

export function escapeDriveQuery(input: string): string {
  return input.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

const DRIVE_FILE_ID_RE = /^[a-zA-Z0-9_\-]{10,60}$/;

export interface DocParagraph {
  type: string;
  text: string;
}

export async function findMeetArtifacts(
  driveClient: drive_v3.Drive,
  attachments: Array<{ fileId?: string; title?: string; mimeType?: string }> | null,
  eventTitle: string,
  eventStart: Date,
  eventEnd: Date,
): Promise<{ transcriptFileId: string | null; notesFileId: string | null }> {
  let transcriptFileId: string | null = null;
  let notesFileId: string | null = null;

  if (attachments) {
    for (const att of attachments) {
      if (att.mimeType !== "application/vnd.google-apps.document") continue;
      if (!att.fileId || !DRIVE_FILE_ID_RE.test(att.fileId)) continue;
      const title = (att.title ?? "").toLowerCase();
      if (title.startsWith("transcript")) {
        transcriptFileId = att.fileId;
      } else if (!notesFileId) {
        notesFileId = att.fileId;
      }
    }
  }

  if (!transcriptFileId || !notesFileId) {
    const searchStart = new Date(eventStart.getTime() - 60 * 60 * 1000);
    const searchEnd = new Date(eventEnd.getTime() + 2 * 60 * 60 * 1000);
    const escaped = escapeDriveQuery(eventTitle);

    try {
      const res = await driveClient.files.list({
        q: `mimeType='application/vnd.google-apps.document' and name contains '${escaped}' and (name contains 'Transcript' or name contains 'Meeting notes') and createdTime > '${searchStart.toISOString()}' and createdTime < '${searchEnd.toISOString()}'`,
        fields: "files(id,name,createdTime)",
        pageSize: 10,
      });

      const files = res.data.files ?? [];
      files.sort((a, b) => {
        const aTime = a.createdTime ? Math.abs(new Date(a.createdTime).getTime() - eventEnd.getTime()) : Infinity;
        const bTime = b.createdTime ? Math.abs(new Date(b.createdTime).getTime() - eventEnd.getTime()) : Infinity;
        return aTime - bTime;
      });

      for (const file of files) {
        if (!file.id) continue;
        const name = (file.name ?? "").toLowerCase();
        if (!transcriptFileId && name.startsWith("transcript")) {
          transcriptFileId = file.id;
        } else if (!notesFileId) {
          notesFileId = file.id;
        }
      }
    } catch (err) {
      console.warn("[google-drive] Drive search failed:", err);
    }
  }

  return { transcriptFileId, notesFileId };
}

export async function readDocContent(docsClient: docs_v1.Docs, fileId: string): Promise<DocParagraph[]> {
  if (!DRIVE_FILE_ID_RE.test(fileId)) {
    throw new Error(`Invalid Google Drive file ID: ${fileId}`);
  }
  const doc = await docsClient.documents.get({ documentId: fileId });
  const content = doc.data.body?.content ?? [];
  const paragraphs: DocParagraph[] = [];
  for (const element of content) {
    if (element.paragraph) {
      const text =
        element.paragraph.elements
          ?.map((e) => e.textRun?.content ?? "")
          .join("")
          .replace(/\n$/, "") ?? "";
      paragraphs.push({ type: "paragraph", text });
    }
  }
  return paragraphs;
}

const TIMESTAMP_SPEAKER_RE = /^\[(\d{1,2}:\d{2}:\d{2})\]\s+(.+)$/;

export function parseTranscriptDoc(content: DocParagraph[]): MeetingTranscriptTurn[] {
  const turns: MeetingTranscriptTurn[] = [];
  let currentSpeaker: string | null = null;
  let currentLines: string[] = [];

  function flushTurn() {
    if (currentSpeaker && currentLines.length > 0) {
      turns.push({ source: "speaker", speaker: currentSpeaker, text: currentLines.join(" ") });
    }
    currentSpeaker = null;
    currentLines = [];
  }

  for (const p of content) {
    const match = TIMESTAMP_SPEAKER_RE.exec(p.text);
    if (match) {
      flushTurn();
      currentSpeaker = match[2]!;
    } else if (p.text.trim() === "") {
      // Empty line — don't flush
    } else if (currentSpeaker) {
      currentLines.push(p.text.trim());
    }
  }
  flushTurn();
  return turns;
}

export function parseMeetingNotesDoc(content: DocParagraph[]): string {
  return content
    .map((p) => p.text)
    .filter((t) => t.length > 0)
    .join("\n");
}
