import { S3Client } from "@aws-sdk/client-s3";

// App storage (attachments, videos, backgrounds)
export const s3 = new S3Client({
  endpoint: process.env.STORAGE_ENDPOINT,
  region: process.env.STORAGE_REGION || "us-east-1",
  credentials: {
    accessKeyId: process.env.STORAGE_ACCESS_KEY || "",
    secretAccessKey: process.env.STORAGE_SECRET_KEY || "",
  },
  forcePathStyle: true,
});

/** @deprecated Use PUBLIC_BUCKET or PRIVATE_BUCKET */
export const BUCKET = process.env.PUBLIC_STORAGE_BUCKET || "brett-public";

export const PUBLIC_BUCKET = process.env.PUBLIC_STORAGE_BUCKET || "brett-public";
export const PRIVATE_BUCKET = process.env.PRIVATE_STORAGE_BUCKET || "brett-private";

// Release storage (DMGs, latest-mac.yml) — separate bucket/credentials for isolation.
// Falls back to app storage vars for local dev (MinIO uses one set of credentials).
export const releaseS3 = new S3Client({
  endpoint: process.env.RELEASE_STORAGE_ENDPOINT || process.env.STORAGE_ENDPOINT,
  region: process.env.STORAGE_REGION || "us-east-1",
  credentials: {
    accessKeyId: process.env.RELEASE_STORAGE_ACCESS_KEY || process.env.STORAGE_ACCESS_KEY || "",
    secretAccessKey: process.env.RELEASE_STORAGE_SECRET_KEY || process.env.STORAGE_SECRET_KEY || "",
  },
  forcePathStyle: true,
});

export const RELEASE_BUCKET = process.env.RELEASE_STORAGE_BUCKET || "brett-releases";
