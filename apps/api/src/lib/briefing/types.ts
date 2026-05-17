// Signal types feeding the briefing detector. See
// docs/superpowers/specs/2026-05-16-briefing-pipeline-v2-design.md.

export type TimeOfDay = "morning" | "midday" | "afternoon" | "evening";

export interface EventRef {
  id: string;
  title: string;
  startTime: string; // ISO
  durationMin: number;
}

export interface ItemRef {
  id: string;
  title: string;
  dueDate: string | null; // ISO date
}

export type Signal =
  | {
      id: string;
      type: "schedule_delta";
      event: EventRef;
      change: "moved" | "cancelled" | "new";
      details: string;
      occurredAt: string;
    }
  | {
      id: string;
      type: "conflict";
      events: EventRef[];
      window: string;
    }
  | {
      id: string;
      type: "prep_gap";
      event: EventRef;
      lastTouchedDays: number | null;
      hasNotes: boolean;
    }
  | {
      id: string;
      type: "overdue_threshold";
      item: ItemRef;
      daysSlipped: number;
      crossedAt: string;
    }
  | {
      id: string;
      type: "inbound";
      source: "email" | "newsletter";
      subject: string;
      summary: string;
      score: number;
      arrivedAt: string;
    }
  | {
      id: string;
      type: "meeting_context";
      event: EventRef;
      relevantPriorNote: string;
      noteSource: string;
    };

export interface NextUpVisible {
  title: string;
  startsInMin: number;
}

export interface DetectorInput {
  timeOfDay: TimeOfDay;
  nextUpVisible: NextUpVisible | null;
  lastBriefAt: string | null;
  priorBriefSignalIds: string[];
  signals: Signal[];
}

export interface DetectorPick {
  signalId: string;
  oneLiner: string;
  why: string;
}

export interface DetectorOutput {
  empty: boolean;
  picks: DetectorPick[];
  reason: string | null;
}

export interface WriterInput {
  timeOfDay: TimeOfDay;
  nextUpVisible: NextUpVisible | null;
  picks: Array<{ oneLiner: string; why: string }>;
}

export type TriggerSource =
  | "morning_bootstrap"
  | "calendar_delta"
  | "inbound"
  | "overdue"
  | "manual"
  | "writer_failed"
  | "detector_failed";

export interface PipelineResult {
  content: string;
  isEmpty: boolean;
  signalsUsedIds: string[];
}
