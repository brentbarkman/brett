import fs from "fs";
import path from "path";
import https from "https";
import http from "http";

const KEY = process.env.UNSPLASH_ACCESS_KEY;
if (!KEY) { console.error("Set UNSPLASH_ACCESS_KEY"); process.exit(1); }

const OUT = path.resolve(__dirname, "../backgrounds/abstract");

async function fetchJson(url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https") ? https : http;
    mod.get(url, { headers: { Authorization: `Client-ID ${KEY}` } }, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try { resolve(JSON.parse(data)); } catch { reject(new Error(`Bad JSON: ${data.slice(0, 100)}`)); }
      });
    }).on("error", reject);
  });
}

async function download(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const mod = url.startsWith("https") ? https : http;
    mod.get(url, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        download(res.headers.location!, dest).then(resolve).catch(reject);
        return;
      }
      const ws = fs.createWriteStream(dest);
      res.pipe(ws);
      ws.on("finish", () => { ws.close(); resolve(); });
    }).on("error", reject);
  });
}

async function dl(destRel: string, query: string, pick: number = 1, force = false) {
  const dest = path.join(OUT, destRel);
  if (!force && fs.existsSync(dest)) { return; }

  const encoded = encodeURIComponent(query);
  const data = await fetchJson(
    `https://api.unsplash.com/search/photos?query=${encoded}&per_page=${pick}&orientation=landscape&order_by=relevant`
  );

  const result = data.results?.[pick - 1];
  if (!result) { console.log(`[FAIL] ${destRel} — no results`); return; }

  await fetchJson(result.links.download_location).catch(() => {});

  const imgUrl = `${result.urls.raw}&w=1920&h=1080&fit=crop&q=80&fm=webp`;
  await download(imgUrl, dest);

  const size = fs.statSync(dest).size;
  console.log(`[ok] ${destRel} (${Math.round(size / 1024)}KB)`);

  await new Promise((r) => setTimeout(r, 800));
}

async function main() {
  console.log("=== Downloading Abstract Backgrounds ===\n");

  // REPLACEMENTS — force re-download
  // morning moderate 1: was too confusing → clean blue-green abstract
  await dl("morning/moderate-1.webp", "abstract blue green gradient clean smooth dark wallpaper", 1, true);
  // morning moderate 2: was too aggressive → softer blue abstract
  await dl("morning/moderate-2.webp", "soft blue abstract gradient calm wallpaper dark", 2, true);

  // REMAINING — skip if exists

  // Afternoon (remaining + more color variety — mix in warm reds, earth tones, not just orange)
  await dl("afternoon/packed-2.webp", "abstract red copper gradient dark wallpaper", 1);
  await dl("afternoon/packed-3.webp", "abstract earth tone gradient warm terracotta dark", 2);

  // Golden hour (mix orange with coral, pink, warm magenta for variety)
  await dl("golden-hour/light-1.webp", "abstract peach coral gradient soft warm wallpaper", 1);
  await dl("golden-hour/light-2.webp", "warm pink gradient abstract mesh soft dark", 2);
  await dl("golden-hour/light-3.webp", "abstract gradient soft rose gold dark wallpaper", 3);
  await dl("golden-hour/moderate-1.webp", "abstract gradient coral magenta flowing dark", 1);
  await dl("golden-hour/moderate-2.webp", "warm abstract gradient pink amber dark wallpaper", 2);
  await dl("golden-hour/moderate-3.webp", "abstract gradient copper rust warm dark", 1);
  await dl("golden-hour/packed-1.webp", "vivid magenta red gradient abstract dark", 1);
  await dl("golden-hour/packed-2.webp", "intense crimson abstract gradient dark wallpaper", 2);
  await dl("golden-hour/packed-3.webp", "deep red orange abstract gradient dark", 3);

  // Evening (mix teal with purple, steel blue, slate for variety)
  await dl("evening/light-1.webp", "abstract dark blue gradient soft minimal wallpaper", 1);
  await dl("evening/light-2.webp", "cool slate gradient abstract dark calm wallpaper", 2);
  await dl("evening/light-3.webp", "abstract gradient dark teal green minimal", 3);
  await dl("evening/moderate-1.webp", "abstract gradient purple blue flowing dark wallpaper", 1);
  await dl("evening/moderate-2.webp", "dark steel blue abstract gradient wallpaper", 2);
  await dl("evening/moderate-3.webp", "abstract gradient cool violet dark mesh", 3);
  await dl("evening/packed-1.webp", "vivid purple blue gradient abstract dark wallpaper", 1);
  await dl("evening/packed-2.webp", "intense dark navy abstract gradient electric", 2);
  await dl("evening/packed-3.webp", "deep indigo violet abstract gradient dark", 3);

  // Night (mix indigo with charcoal, deep space, subtle aurora hints)
  await dl("night/light-1.webp", "abstract dark gradient minimal charcoal wallpaper", 1);
  await dl("night/light-2.webp", "dark abstract gradient deep space minimal wallpaper", 2);
  await dl("night/light-3.webp", "abstract gradient very dark blue subtle wallpaper", 3);
  await dl("night/moderate-1.webp", "abstract dark gradient deep purple space wallpaper", 1);
  await dl("night/moderate-2.webp", "dark abstract gradient indigo navy wallpaper", 2);
  await dl("night/moderate-3.webp", "abstract gradient dark blue violet deep wallpaper", 3);
  await dl("night/packed-1.webp", "abstract dark gradient neon accent indigo wallpaper", 1);
  await dl("night/packed-2.webp", "dark abstract gradient aurora green blue wallpaper", 2);
  await dl("night/packed-3.webp", "deep dark abstract gradient electric purple wallpaper", 3);

  const all = fs.readdirSync(OUT, { recursive: true })
    .filter((f: any) => f.toString().endsWith(".webp"));
  console.log(`\n=== ${all.length} total abstract images ===`);
}

main().catch((err) => { console.error(err); process.exit(1); });
