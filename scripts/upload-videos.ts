import "dotenv/config";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import fs from "fs";
import path from "path";
import { s3, PUBLIC_BUCKET as BUCKET } from "./s3";

const VIDEO_DIR = path.resolve(__dirname, "../apps/desktop/public/videos");

const CONTENT_TYPES: Record<string, string> = {
  ".mp4": "video/mp4",
  ".webm": "video/webm",
};

function walk(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(full));
    } else if (entry.name.endsWith(".mp4") || entry.name.endsWith(".webm")) {
      files.push(full);
    }
  }
  return files;
}

async function uploadVideos() {
  const files = walk(VIDEO_DIR);
  console.log(`Found ${files.length} video files to upload...\n`);

  for (const filePath of files) {
    const body = fs.readFileSync(filePath);
    const relative = path.relative(VIDEO_DIR, filePath);
    const key = `videos/${relative}`;
    const ext = path.extname(filePath);
    const contentType = CONTENT_TYPES[ext] ?? "application/octet-stream";

    console.log(`Uploading ${relative} (${(body.length / 1024 / 1024).toFixed(1)} MB)...`);

    await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: body,
        ContentType: contentType,
        ACL: "public-read",
      })
    );

    console.log(`  ✓ ${key}`);
  }

  console.log("\nAll videos uploaded.");
}

uploadVideos().catch((err) => {
  console.error("Upload failed:", err);
  process.exit(1);
});
