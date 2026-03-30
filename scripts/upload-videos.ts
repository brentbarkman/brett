import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import fs from "fs";
import path from "path";

const s3 = new S3Client({
  endpoint: process.env.STORAGE_ENDPOINT,
  region: process.env.STORAGE_REGION || "us-east-1",
  credentials: {
    accessKeyId: process.env.STORAGE_ACCESS_KEY || "",
    secretAccessKey: process.env.STORAGE_SECRET_KEY || "",
  },
  forcePathStyle: true,
});

const BUCKET = process.env.STORAGE_BUCKET || "brett";
const VIDEO_DIR = path.resolve(__dirname, "../apps/desktop/public/videos");

async function uploadVideos() {
  const files = fs.readdirSync(VIDEO_DIR).filter((f) => f.endsWith(".mp4"));
  console.log(`Found ${files.length} videos to upload...\n`);

  for (const file of files) {
    const filePath = path.join(VIDEO_DIR, file);
    const body = fs.readFileSync(filePath);
    const key = `public/videos/${file}`;

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
