import { PutObjectCommand } from "@aws-sdk/client-s3";
import fs from "fs";
import path from "path";
import { s3, PUBLIC_BUCKET as BUCKET } from "./s3";

const BG_DIR = path.resolve(__dirname, "../backgrounds");

async function uploadBackgrounds() {
  function walk(dir: string): string[] {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...walk(full));
      } else if (entry.name.endsWith(".webp")) {
        files.push(full);
      }
    }
    return files;
  }

  const files = walk(BG_DIR);
  console.log(`Found ${files.length} background images to upload...\n`);

  for (const filePath of files) {
    const body = fs.readFileSync(filePath);
    const relative = path.relative(path.resolve(__dirname, ".."), filePath);
    const key = relative;

    console.log(`Uploading ${relative} (${(body.length / 1024).toFixed(0)} KB)...`);

    await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: body,
        ContentType: "image/webp",
        ACL: "public-read",
      })
    );

    console.log(`  ✓ ${key}`);
  }

  console.log(`\nAll ${files.length} backgrounds uploaded.`);
}

uploadBackgrounds().catch((err) => {
  console.error("Upload failed:", err);
  process.exit(1);
});
