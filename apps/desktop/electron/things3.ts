import path from "path";
import os from "os";
import fs from "fs";
import initSqlJs, { type Database } from "sql.js";
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

async function openDatabase(): Promise<Database> {
  if (!fs.existsSync(THINGS_DB_PATH)) {
    throw new Error("Things 3 database not found. Is Things 3 installed?");
  }
  const SQL = await initSqlJs();
  const buffer = fs.readFileSync(THINGS_DB_PATH);
  return new SQL.Database(buffer);
}

/** Run a query and return rows as typed objects */
function query<T>(db: Database, sql: string): T[] {
  const result = db.exec(sql);
  if (result.length === 0) return [];
  const { columns, values } = result[0];
  return values.map((row) => {
    const obj: any = {};
    columns.forEach((col, i) => {
      obj[col] = row[i];
    });
    return obj as T;
  });
}

/** Run a query and return a single row */
function queryOne<T>(db: Database, sql: string): T {
  const rows = query<T>(db, sql);
  return rows[0];
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

export async function scanThings3(): Promise<Things3ScanResult> {
  const db = await openDatabase();
  try {
    const projects = queryOne<{ count: number }>(
      db, "SELECT COUNT(*) as count FROM TMTask WHERE type = 1 AND trashed = 0"
    );
    const activeTasks = queryOne<{ count: number }>(
      db, "SELECT COUNT(*) as count FROM TMTask WHERE type = 0 AND trashed = 0 AND status = 0"
    );
    const completedTasks = queryOne<{ count: number }>(
      db, "SELECT COUNT(*) as count FROM TMTask WHERE type = 0 AND trashed = 0 AND status IN (2, 3)"
    );

    return {
      projects: projects.count,
      tasks: { active: activeTasks.count, completed: completedTasks.count },
    };
  } finally {
    db.close();
  }
}

export async function readThings3(): Promise<Things3ImportPayload> {
  const db = await openDatabase();
  try {
    const projects = query<{ uuid: string; title: string }>(
      db,
      'SELECT uuid, title FROM TMTask WHERE type = 1 AND trashed = 0 ORDER BY "index"'
    );

    const tasks = query<ThingsTask>(
      db,
      `SELECT uuid, title, notes, status, creationDate, stopDate, deadline, project
       FROM TMTask WHERE type = 0 AND trashed = 0
       ORDER BY "index"`
    );

    const checklists = query<ThingsChecklist>(
      db,
      `SELECT ci.uuid, ci.title, ci.status, ci.task, ci."index"
       FROM TMChecklistItem ci
       INNER JOIN TMTask t ON ci.task = t.uuid
       WHERE t.type = 0 AND t.trashed = 0
       ORDER BY ci."index"`
    );

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

      // Cap notes to prevent oversized payloads
      if (notes && notes.length > 100_000) {
        notes = notes.slice(0, 100_000);
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
