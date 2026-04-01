import fs from "fs";
import path from "path";
import https from "https";

const KEY = process.env.UNSPLASH_ACCESS_KEY;
if (!KEY) { console.error("Set UNSPLASH_ACCESS_KEY"); process.exit(1); }

const OUT = path.resolve(__dirname, "../backgrounds/abstract");

async function fetchJson(url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { Authorization: `Client-ID ${KEY}` } }, (res) => {
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
    https.get(url, (res) => {
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

async function dl(destRel: string, query: string, pick: number = 1) {
  const dest = path.join(OUT, destRel);
  // Always force — replacing all night images
  const encoded = encodeURIComponent(query);
  const data = await fetchJson(
    `https://api.unsplash.com/search/photos?query=${encoded}&per_page=${pick}&orientation=landscape&order_by=relevant`
  );
  const result = data.results?.[pick - 1];
  if (!result) { console.log(`[FAIL] ${destRel}`); return; }
  await fetchJson(result.links.download_location).catch(() => {});
  await download(`${result.urls.raw}&w=1920&h=1080&fit=crop&q=80&fm=webp`, dest);
  console.log(`[ok] ${destRel} (${Math.round(fs.statSync(dest).size / 1024)}KB)`);
  await new Promise((r) => setTimeout(r, 800));
}

async function main() {
  console.log("=== Replacing all 9 night abstract images ===\n");

  // Night light — subtle, dark, barely-there color. Like looking at a dark sky.
  await dl("night/light-1.webp", "abstract dark wallpaper minimal black subtle gradient", 1);
  await dl("night/light-2.webp", "dark minimalist abstract background deep black blue", 2);
  await dl("night/light-3.webp", "abstract very dark gradient subtle purple black wallpaper", 3);

  // Night moderate — more visible color. Deep space, dark nebula feel.
  await dl("night/moderate-1.webp", "dark nebula abstract gradient deep space wallpaper", 1);
  await dl("night/moderate-2.webp", "abstract dark blue purple gradient space wallpaper", 2);
  await dl("night/moderate-3.webp", "dark abstract gradient midnight blue violet wallpaper", 3);

  // Night packed — dramatic dark with accent color. Aurora, electric.
  await dl("night/packed-1.webp", "dark abstract aurora gradient green purple wallpaper", 1);
  await dl("night/packed-2.webp", "abstract dark gradient neon blue electric wallpaper", 2);
  await dl("night/packed-3.webp", "dark abstract gradient vivid purple blue glow wallpaper", 3);

  const total = fs.readdirSync(OUT, { recursive: true })
    .filter((f: any) => f.toString().endsWith(".webp")).length;
  console.log(`\n=== ${total} total abstract images ===`);
}

main().catch((err) => { console.error(err); process.exit(1); });
