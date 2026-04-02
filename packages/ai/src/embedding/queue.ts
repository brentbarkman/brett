import { AI_CONFIG } from "../config.js";

export interface EmbedJob {
  entityType: string;
  entityId: string;
  userId: string;
  /** Skip auto-link detection (e.g., when inline dup detection already ran at creation time) */
  skipAutoLink?: boolean;
}

type JobProcessor = (job: EmbedJob) => Promise<void>;

const pending = new Map<string, { timeout: NodeJS.Timeout; job: EmbedJob }>();
let processor: JobProcessor | null = null;

function jobKey(job: EmbedJob): string {
  return `${job.entityType}:${job.entityId}`;
}

export function setEmbedProcessor(fn: JobProcessor): void {
  processor = fn;
}

async function processWithRetry(job: EmbedJob): Promise<void> {
  if (!processor) return;

  let attempt = 0;
  const key = jobKey(job);

  while (attempt < AI_CONFIG.embedding.maxRetries) {
    try {
      await processor(job);
      return;
    } catch (err) {
      attempt++;
      if (attempt < AI_CONFIG.embedding.maxRetries) {
        await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));
      } else {
        console.error(
          `[embedding] Failed after ${attempt} attempts for ${key}:`,
          err
        );
      }
    }
  }
}

export function enqueueEmbed(job: EmbedJob): void {
  if (!processor) return;

  const key = jobKey(job);
  const existing = pending.get(key);
  if (existing) clearTimeout(existing.timeout);

  const timeout = setTimeout(() => {
    pending.delete(key);
    // Fire-and-forget — never throws
    processWithRetry(job).catch(() => {});
  }, AI_CONFIG.embedding.debounceMs);

  pending.set(key, { timeout, job });
}

/**
 * For testing: clears all pending timeouts and processes all queued jobs immediately.
 */
export async function flushEmbedQueue(): Promise<void> {
  const jobs: EmbedJob[] = [];

  for (const [, entry] of pending) {
    clearTimeout(entry.timeout);
    jobs.push(entry.job);
  }
  pending.clear();

  if (!processor) return;

  for (const job of jobs) {
    await processWithRetry(job);
  }
}
