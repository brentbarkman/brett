// scripts/backgrounds/unsplash-source.ts

import "dotenv/config";
import fs from "fs";
import path from "path";
import readline from "readline";
import { QUERY_BY_CATEGORY } from "./unsplash-queries";

type AuditEntry = {
  path: string;
  segment: string;
  tier: string;
  verdict: "keep" | "cut" | "replace";
  notes: string;
};

type SourceEntry = {
  segment: string;
  tier: string;
  slot: string;          // matches the manifest path slot, e.g. "photo/dawn/light-2.webp"
  unsplashId: string;
  photographer: string;
  unsplashUrl: string;
  downloadUrl: string;
};

const RESULTS_PATH = path.resolve(__dirname, "audit-results.json");
const SOURCES_PATH = path.resolve(__dirname, "replacement-sources.json");

const KEY = process.env.UNSPLASH_ACCESS_KEY;
if (!KEY) {
  console.error("Set UNSPLASH_ACCESS_KEY in .env (see .env.example).");
  process.exit(1);
}

async function search(query: string, page = 1) {
  const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&orientation=landscape&per_page=10&page=${page}`;
  const resp = await fetch(url, {
    headers: { Authorization: `Client-ID ${KEY}` },
  });
  if (!resp.ok) throw new Error(`Unsplash API error: ${resp.status} ${await resp.text()}`);
  return await resp.json();
}

async function prompt(rl: readline.Interface, q: string): Promise<string> {
  return new Promise((resolve) => rl.question(q, resolve));
}

async function main() {
  if (!fs.existsSync(RESULTS_PATH)) {
    console.error(`Missing ${RESULTS_PATH}. Run 'pnpm audit:backgrounds' first.`);
    process.exit(1);
  }

  const audit: Record<string, AuditEntry> = JSON.parse(fs.readFileSync(RESULTS_PATH, "utf-8"));
  const sources: Record<string, SourceEntry> = fs.existsSync(SOURCES_PATH)
    ? JSON.parse(fs.readFileSync(SOURCES_PATH, "utf-8"))
    : {};

  const toReplace = Object.values(audit).filter(
    (e) => e.verdict === "replace" && !(e.path in sources)
  );

  console.log(`\nNeed sources for ${toReplace.length} slots.\n`);

  if (toReplace.length === 0) {
    console.log("All replacements sourced. Run 'pnpm process:backgrounds' next.");
    return;
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  for (let i = 0; i < toReplace.length; i++) {
    const slot = toReplace[i];
    const categoryKey = `${slot.segment}/${slot.tier}`;
    const query = QUERY_BY_CATEGORY[categoryKey];
    if (!query) {
      console.error(`No query defined for ${categoryKey} — add to unsplash-queries.ts.`);
      continue;
    }

    console.log(`\n[${i + 1}/${toReplace.length}] Slot: ${slot.path}`);
    console.log(`  Category: ${categoryKey}`);
    console.log(`  Query: "${query}"`);
    console.log(`  Browse: https://unsplash.com/s/photos/${encodeURIComponent(query)}?orientation=landscape`);

    let page = 1;
    let skipped = false;
    while (true) {
      const data = await search(query, page);
      console.log(`\n  Page ${page} — ${data.results.length} candidates:`);
      data.results.forEach((p: any, idx: number) => {
        console.log(`    [${idx + 1}] ${p.id} — ${p.user.name} — ${p.alt_description ?? "(no description)"} — ${p.urls.regular}`);
      });

      const choice = (await prompt(rl, "  Pick (1-10), 'n' for next page, 'q' to skip slot: ")).trim().toLowerCase();
      if (choice === "n") { page++; continue; }
      if (choice === "q") { skipped = true; break; }

      const idx = parseInt(choice, 10) - 1;
      if (Number.isNaN(idx) || idx < 0 || idx >= data.results.length) {
        console.log("  Invalid pick.");
        continue;
      }

      const photo = data.results[idx];
      sources[slot.path] = {
        segment: slot.segment,
        tier: slot.tier,
        slot: slot.path,
        unsplashId: photo.id,
        photographer: photo.user.name,
        unsplashUrl: photo.links.html,
        downloadUrl: photo.urls.full, // full-resolution
      };
      fs.writeFileSync(SOURCES_PATH, JSON.stringify(sources, null, 2));

      // Trigger Unsplash download tracking endpoint (required by API guidelines)
      await fetch(photo.links.download_location, {
        headers: { Authorization: `Client-ID ${KEY}` },
      });

      console.log(`  ✓ Saved.`);
      break;
    }

    if (skipped) continue;
  }

  rl.close();
  console.log(`\nDone. Sources saved to ${SOURCES_PATH}`);
  console.log(`Run 'pnpm process:backgrounds' next.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
