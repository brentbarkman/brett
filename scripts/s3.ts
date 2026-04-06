import { S3Client } from "@aws-sdk/client-s3";

function createClient(prefix: string): S3Client {
  // Each Railway Object Storage instance has its own endpoint + credentials.
  // Fall back to generic STORAGE_* vars for local dev (MinIO shares one set).
  return new S3Client({
    endpoint: process.env[`${prefix}_STORAGE_ENDPOINT`] || process.env.STORAGE_ENDPOINT,
    region: process.env.STORAGE_REGION || "us-east-1",
    credentials: {
      accessKeyId: process.env[`${prefix}_STORAGE_ACCESS_KEY`] || process.env.STORAGE_ACCESS_KEY || "",
      secretAccessKey: process.env[`${prefix}_STORAGE_SECRET_KEY`] || process.env.STORAGE_SECRET_KEY || "",
    },
    forcePathStyle: true,
  });
}

/** Public assets (videos, backgrounds) — anonymous read */
export const publicS3 = createClient("PUBLIC");
export const PUBLIC_BUCKET = process.env.PUBLIC_STORAGE_BUCKET || "brett-public";

/** Desktop releases (DMGs, latest-mac.yml) — separate credentials in prod */
export const releaseS3 = createClient("RELEASE");
export const RELEASE_BUCKET = process.env.RELEASE_STORAGE_BUCKET || "brett-releases";

/** @deprecated Use publicS3 */
export const s3 = publicS3;
/** @deprecated Use PUBLIC_BUCKET */
export const BUCKET = PUBLIC_BUCKET;
