import { google, type drive_v3, type docs_v1 } from "googleapis";
import { decryptToken } from "./encryption.js";
import type { MeetingTranscriptTurn } from "@brett/types";

interface GoogleAccountTokens {
  accessToken: string;
  refreshToken: string;
}

export function getDriveClient(tokens: GoogleAccountTokens): drive_v3.Drive {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
  );
  oauth2Client.setCredentials({
    access_token: decryptToken(tokens.accessToken),
    refresh_token: decryptToken(tokens.refreshToken),
  });
  return google.drive({ version: "v3", auth: oauth2Client });
}

export function getDocsClient(tokens: GoogleAccountTokens): docs_v1.Docs {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
  );
  oauth2Client.setCredentials({
    access_token: decryptToken(tokens.accessToken),
    refresh_token: decryptToken(tokens.refreshToken),
  });
  return google.docs({ version: "v1", auth: oauth2Client });
}

export function escapeDriveQuery(input: string): string {
  return input.replace(/'/g, "\\'");
}

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
      if (!att.fileId) continue;
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
        q: `mimeType='application/vnd.google-apps.document' and name contains '${escaped}' and createdTime > '${searchStart.toISOString()}' and createdTime < '${searchEnd.toISOString()}'`,
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
