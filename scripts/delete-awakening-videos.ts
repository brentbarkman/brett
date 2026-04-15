import "dotenv/config";
import {
  DeleteObjectsCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { publicS3 as s3, PUBLIC_BUCKET as BUCKET } from "./s3";

/**
 * Removes the now-unused awakening video files from Railway Object Storage.
 * Targets `videos/awakening/` prefix — the 6 segment clips × 2 encodings
 * (mp4 + webm) uploaded for the video-based awakening prototype.
 *
 * Run with the same env vars as `upload:videos`:
 *
 *   PUBLIC_STORAGE_ENDPOINT=https://<...>.bucket.railway.internal \
 *   PUBLIC_STORAGE_ACCESS_KEY=<key> \
 *   PUBLIC_STORAGE_SECRET_KEY=<secret> \
 *   PUBLIC_STORAGE_BUCKET=<bucket-name> \
 *   STORAGE_REGION=<region> \
 *   pnpm delete:awakening-videos
 */
const PREFIX = "videos/awakening/";

async function deleteAwakeningVideos() {
  console.log(`Listing objects under ${BUCKET}/${PREFIX}...`);

  const listed = await s3.send(
    new ListObjectsV2Command({ Bucket: BUCKET, Prefix: PREFIX })
  );

  const objects = (listed.Contents ?? []).filter((o) => o.Key);
  if (objects.length === 0) {
    console.log("Nothing to delete — prefix is already empty.");
    return;
  }

  console.log(`Found ${objects.length} object(s):`);
  for (const obj of objects) {
    const sizeKB = obj.Size != null ? (obj.Size / 1024).toFixed(0) : "?";
    console.log(`  ${obj.Key} (${sizeKB} KB)`);
  }

  const result = await s3.send(
    new DeleteObjectsCommand({
      Bucket: BUCKET,
      Delete: {
        Objects: objects.map((o) => ({ Key: o.Key! })),
        Quiet: false,
      },
    })
  );

  const deletedCount = result.Deleted?.length ?? 0;
  const errorCount = result.Errors?.length ?? 0;
  console.log(`\nDeleted ${deletedCount} object(s). ${errorCount} error(s).`);
  if (result.Errors && result.Errors.length > 0) {
    for (const err of result.Errors) {
      console.error(`  ${err.Key}: ${err.Code} — ${err.Message}`);
    }
    process.exit(1);
  }
}

deleteAwakeningVideos().catch((err) => {
  console.error("Delete failed:", err);
  process.exit(1);
});
