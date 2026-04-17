// scripts/backgrounds/audit-cli.ts

import fs from "fs";
import path from "path";
import readline from "readline";
import { backgroundManifest as manifest } from "@brett/business";

type Verdict = "keep" | "cut" | "replace";
type AuditEntry = {
  path: string;
  segment: string;
  tier: string;
  verdict: Verdict;
  notes: string;
};

const RESULTS_PATH = path.resolve(__dirname, "audit-results.json");

function loadExistingResults(): Record<string, AuditEntry> {
  if (!fs.existsSync(RESULTS_PATH)) return {};
  return JSON.parse(fs.readFileSync(RESULTS_PATH, "utf-8"));
}

function saveResults(results: Record<string, AuditEntry>) {
  fs.writeFileSync(RESULTS_PATH, JSON.stringify(results, null, 2));
}

function flattenManifest(): { path: string; segment: string; tier: string }[] {
  const photo = manifest.sets.photography;
  const out: { path: string; segment: string; tier: string }[] = [];
  for (const [segment, tiers] of Object.entries(photo)) {
    for (const [tier, paths] of Object.entries(tiers as Record<string, string[]>)) {
      for (const p of paths) {
        out.push({ path: p, segment, tier });
      }
    }
  }
  return out;
}

async function prompt(rl: readline.Interface, q: string): Promise<string> {
  return new Promise((resolve) => rl.question(q, resolve));
}

async function main() {
  const all = flattenManifest();
  const results = loadExistingResults();
  const remaining = all.filter((img) => !(img.path in results));

  console.log(`\nTotal images: ${all.length}`);
  console.log(`Already audited: ${Object.keys(results).length}`);
  console.log(`Remaining: ${remaining.length}\n`);

  if (remaining.length === 0) {
    console.log("All images audited. Run 'pnpm source:backgrounds' next.");
    return;
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  for (let i = 0; i < remaining.length; i++) {
    const img = remaining[i];
    console.log(`\n[${i + 1}/${remaining.length}] ${img.path}`);
    console.log(`  Category: ${img.segment} / ${img.tier}`);
    console.log(`  Pin this in Settings → Background to view it across the app.`);

    const v = (await prompt(rl, "  Verdict (k=keep, c=cut, r=replace, q=quit): ")).trim().toLowerCase();
    if (v === "q") break;

    let verdict: Verdict;
    if (v === "k") verdict = "keep";
    else if (v === "c") verdict = "cut";
    else if (v === "r") verdict = "replace";
    else {
      console.log("  Invalid input — skipping.");
      continue;
    }

    const notes = (await prompt(rl, "  Notes (optional): ")).trim();

    results[img.path] = { ...img, verdict, notes };
    saveResults(results);
    console.log(`  ✓ Saved.`);
  }

  rl.close();

  const counts = { keep: 0, cut: 0, replace: 0 };
  for (const e of Object.values(results)) counts[e.verdict]++;
  console.log(`\nDone. ${counts.keep} keep, ${counts.cut} cut, ${counts.replace} replace.`);
  console.log(`Results saved to ${RESULTS_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
