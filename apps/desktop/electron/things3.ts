import path from "path";
import os from "os";
import fs from "fs";
import Database from "better-sqlite3";
import type {
  Things3ImportPayload,
  Things3ScanResult,
} from "@brett/types";

const THINGS_DB_PATH = path.join(
  os.homedir(),
  "Library",
  "Group Containers",
  "JLMPQHK86H.com.culturedcode.ThingsMac",
  "Things Database.thingsdatabase",
  "main.sqlite"
);

/**
 * Decode Things 3's packed binary date format.
 * Format: YYYYYYYYYYYMMMMDDDDD0000000 (11 bits year, 4 bits month, 5 bits day, 7 zero bits)
 */
function decodeThingsDate(value: number): string | undefined {
  if (!value || value === 0) return undefined;
  const day = (value >> 7) & 0x1f;
  const month = (value >> 12) & 0xf;
  const year = (value >> 16) & 0x7ff;
  if (year === 0 || month === 0 || day === 0) return undefined;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Convert a Things 3 Unix timestamp (seconds) to ISO 8601 string */
function thingsTimestampToISO(ts: number | null): string | undefined {
  if (!ts || ts === 0) return undefined;
  return new Date(ts * 1000).toISOString();
}

interface ThingsTask {
  uuid: string;
  type: number;
  title: string;
  notes: string | null;
  status: number;
  trashed: number;
  creationDate: number;
  stopDate: number | null;
  deadline: number | null;
  project: string | null;
}

interface ThingsChecklist {
  uuid: string;
  title: string;
  status: number;
  task: string;
  index: number;
}

function openDatabase(): Database.Database {
  if (!fs.existsSync(THINGS_DB_PATH)) {
    throw new Error("Things 3 database not found. Is Things 3 installed?");
  }
  return new Database(THINGS_DB_PATH, { readonly: true, fileMustExist: true });
}

/** Build markdown checklist string from checklist items */
function buildChecklistMarkdown(items: ThingsChecklist[]): string {
  const sorted = [...items].sort((a, b) => a.index - b.index);
  return sorted
    .map((item) => {
      const checked = item.status === 3 ? "x" : " ";
      return `- [${checked}] ${item.title}`;
    })
    .join("\n");
}

export function scanThings3(): Things3ScanResult {
  const db = openDatabase();
  try {
    const projects = db
      .prepare("SELECT COUNT(*) as count FROM TMTask WHERE type = 1 AND trashed = 0")
      .get() as { count: number };
    const activeTasks = db
      .prepare("SELECT COUNT(*) as count FROM TMTask WHERE type = 0 AND trashed = 0 AND status = 0")
      .get() as { count: number };
    const completedTasks = db
      .prepare("SELECT COUNT(*) as count FROM TMTask WHERE type = 0 AND trashed = 0 AND status IN (2, 3)")
      .get() as { count: number };

    return {
      projects: projects.count,
      tasks: { active: activeTasks.count, completed: completedTasks.count },
    };
  } finally {
    db.close();
  }
}

export function readThings3(): Things3ImportPayload {
  const db = openDatabase();
  try {
    const projects = db
      .prepare(
        "SELECT uuid, title FROM TMTask WHERE type = 1 AND trashed = 0 ORDER BY \"index\""
      )
      .all() as { uuid: string; title: string }[];

    const tasks = db
      .prepare(
        `SELECT uuid, title, notes, status, creationDate, stopDate, deadline, project
         FROM TMTask WHERE type = 0 AND trashed = 0
         ORDER BY "index"`
      )
      .all() as ThingsTask[];

    const checklists = db
      .prepare(
        `SELECT ci.uuid, ci.title, ci.status, ci.task, ci."index"
         FROM TMChecklistItem ci
         INNER JOIN TMTask t ON ci.task = t.uuid
         WHERE t.type = 0 AND t.trashed = 0
         ORDER BY ci."index"`
      )
      .all() as ThingsChecklist[];

    const checklistsByTask = new Map<string, ThingsChecklist[]>();
    for (const item of checklists) {
      const existing = checklistsByTask.get(item.task) ?? [];
      existing.push(item);
      checklistsByTask.set(item.task, existing);
    }

    const lists = projects.map((p) => ({
      name: p.title || "Untitled Project",
      thingsUuid: p.uuid,
    }));

    const mappedTasks = tasks.map((t) => {
      const status = t.status === 0 ? "active" : "done";
      let notes = t.notes ?? undefined;

      const checklistItems = checklistsByTask.get(t.uuid);
      if (checklistItems && checklistItems.length > 0) {
        const checklistMd = buildChecklistMarkdown(checklistItems);
        notes = notes ? `${notes}\n\n${checklistMd}` : checklistMd;
      }

      return {
        title: t.title || "Untitled",
        notes,
        dueDate: t.deadline ? decodeThingsDate(t.deadline) : undefined,
        status: status as "active" | "done",
        completedAt: thingsTimestampToISO(t.stopDate),
        createdAt: thingsTimestampToISO(t.creationDate),
        thingsProjectUuid: t.project ?? undefined,
      };
    });

    return { lists, tasks: mappedTasks };
  } finally {
    db.close();
  }
}
