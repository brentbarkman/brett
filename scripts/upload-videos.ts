import "dotenv/config";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import fs from "fs";
import path from "path";
import { s3, PUBLIC_BUCKET as BUCKET } from "./s3";

const VIDEO_DIR = path.resolve(__dirname, "../apps/desktop/public/videos");

async function uploadVideos() {
  const files = fs.readdirSync(VIDEO_DIR).filter((f) => f.endsWith(".mp4"));
  console.log(`Found ${files.length} videos to upload...\n`);

  for (const file of files) {
    const filePath = path.join(VIDEO_DIR, file);
    const body = fs.readFileSync(filePath);
    const key = `videos/${file}`;

    console.log(`Uploading ${file} (${(body.length / 1024 / 1024).toFixed(1)} MB)...`);

    await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: body,
        ContentType: "video/mp4",
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
