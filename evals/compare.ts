/**
 * Compare two eval runs — shows score deltas per suite and the specific cases
 * that regressed (pass → fail) or newly passed (fail → pass).
 *
 * Usage:
 *   pnpm eval:compare                              # latest two anthropic runs
 *   pnpm eval:compare --provider openai            # latest two openai runs
 *   pnpm eval:compare --base <file> --head <file>  # explicit pair
 *
 * File args are filenames inside evals/runs/ (e.g. 2026-04-20T21-45-11Z-anthropic.json).
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RUNS_DIR = path.join(__dirname, "runs");

interface EvalResult {
  input: string;
  expected: string | null;
  actual: string | null;
  passed: boolean;
  note?: string;
}

interface SuiteResult {
  suite: string;
  provider: string;
  model: string;
  timestamp: string;
  passed: number;
  total: number;
  score: number;
  results: EvalResult[];
  promptHash?: string;
  fixtureHash?: string;
}

function getArg(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx !== -1 ? args[idx + 1] : undefined;
}

function loadRun(filename: string): SuiteResult[] {
  const fullPath = path.isAbsolute(filename) ? filename : path.join(RUNS_DIR, filename);
  if (!fs.existsSync(fullPath)) {
    console.error(`File not found: ${fullPath}`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(fullPath, "utf-8")) as SuiteResult[];
}

function findLatestTwo(provider: string): { base: string; head: string } | null {
  if (!fs.existsSync(RUNS_DIR)) return null;
  const matching = fs
    .readdirSync(RUNS_DIR)
    .filter((f) => f.endsWith(`-${provider}.json`))
    .sort(); // ISO timestamps sort chronologically
  if (matching.length < 2) return null;
  return { base: matching[matching.length - 2], head: matching[matching.length - 1] };
}

function fmtPct(score: number): string {
  return `${(score * 100).toFixed(1)}%`;
}

function fmtDelta(delta: number): string {
  const pct = (delta * 100).toFixed(1);
  if (delta > 0.001) return `+${pct}%`;
  if (delta < -0.001) return `${pct}%`;
  return "±0.0%";
}

function main(): void {
  const args = process.argv.slice(2);
  const provider = getArg(args, "--provider") ?? "anthropic";
  let baseFile = getArg(args, "--base");
  let headFile = getArg(args, "--head");

  if (!baseFile || !headFile) {
    const latest = findLatestTwo(provider);
    if (!latest) {
      console.error(`Need at least 2 runs for provider "${provider}" in evals/runs/. Run \`pnpm eval\` twice first.`);
      process.exit(1);
    }
    baseFile = latest.base;
    headFile = latest.head;
  }

  const baseResults = loadRun(baseFile);
  const headResults = loadRun(headFile);

  console.log(`\nBase: ${baseFile}`);
  console.log(`Head: ${headFile}\n`);

  // Prompt/fixture hash deltas — surfaces whether a regression is caused by
  // a prompt edit or a fixture edit vs. model drift.
  const changedHashes: string[] = [];
  const allSuiteNames = new Set([
    ...baseResults.map((r) => r.suite),
    ...headResults.map((r) => r.suite),
  ]);
  for (const suite of allSuiteNames) {
    const base = baseResults.find((r) => r.suite === suite);
    const head = headResults.find((r) => r.suite === suite);
    if (!base || !head) continue;
    if (base.promptHash && head.promptHash && base.promptHash !== head.promptHash) {
      changedHashes.push(`  prompt changed: ${suite} (${base.promptHash} → ${head.promptHash})`);
    }
    if (base.fixtureHash && head.fixtureHash && base.fixtureHash !== head.fixtureHash) {
      changedHashes.push(`  fixtures changed: ${suite} (${base.fixtureHash} → ${head.fixtureHash})`);
    }
  }
  if (changedHashes.length > 0) {
    console.log("Changes since base:");
    for (const line of changedHashes) console.log(line);
    console.log();
  }

  // Suite-level deltas
  console.log("─".repeat(78));
  console.log(`${"Suite".padEnd(28)} ${"Base".padEnd(16)} ${"Head".padEnd(16)} Delta`);
  console.log("─".repeat(78));

  const allSuites = new Set([...baseResults.map((r) => r.suite), ...headResults.map((r) => r.suite)]);
  const regressions: { suite: string; input: string; expected: string | null; baseActual: string | null; headActual: string | null; note?: string }[] = [];
  const improvements: { suite: string; input: string; expected: string | null; headActual: string | null }[] = [];

  for (const suite of allSuites) {
    const base = baseResults.find((r) => r.suite === suite);
    const head = headResults.find((r) => r.suite === suite);

    const baseCell = base ? `${fmtPct(base.score)} (${base.passed}/${base.total})` : "—";
    const headCell = head ? `${fmtPct(head.score)} (${head.passed}/${head.total})` : "—";
    const delta = base && head ? fmtDelta(head.score - base.score) : "—";

    console.log(`${suite.padEnd(28)} ${baseCell.padEnd(16)} ${headCell.padEnd(16)} ${delta}`);

    if (!base || !head) continue;

    // Per-case regressions and improvements, keyed by input string
    const baseByInput = new Map(base.results.map((r) => [r.input, r]));
    const headByInput = new Map(head.results.map((r) => [r.input, r]));

    for (const [input, headResult] of headByInput) {
      const baseResult = baseByInput.get(input);
      if (!baseResult) continue; // new case — not a regression or improvement
      if (baseResult.passed && !headResult.passed) {
        regressions.push({
          suite,
          input,
          expected: headResult.expected,
          baseActual: baseResult.actual,
          headActual: headResult.actual,
          note: headResult.note,
        });
      } else if (!baseResult.passed && headResult.passed) {
        improvements.push({
          suite,
          input,
          expected: headResult.expected,
          headActual: headResult.actual,
        });
      }
    }
  }

  console.log("─".repeat(78));

  if (regressions.length > 0) {
    console.log(`\nRegressions (pass → fail): ${regressions.length}`);
    for (const r of regressions) {
      console.log(`  [${r.suite}] "${r.input.slice(0, 60)}"`);
      console.log(`    expected: ${r.expected}`);
      console.log(`    was:      ${r.baseActual}`);
      console.log(`    now:      ${r.headActual}`);
      if (r.note) console.log(`    note:     ${r.note}`);
    }
  } else {
    console.log(`\nRegressions: none`);
  }

  if (improvements.length > 0) {
    console.log(`\nNewly passing (fail → pass): ${improvements.length}`);
    for (const r of improvements) {
      console.log(`  [${r.suite}] "${r.input.slice(0, 60)}"`);
      console.log(`    expected: ${r.expected}`);
      console.log(`    now:      ${r.headActual}`);
    }
  } else {
    console.log(`\nNewly passing: none`);
  }

  console.log();
  process.exit(regressions.length > 0 ? 1 : 0);
}

main();
