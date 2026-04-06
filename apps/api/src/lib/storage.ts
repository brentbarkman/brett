import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

function createS3Client(prefix: string): S3Client {
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

/** S3 client for private storage (user attachments). */
export const privateS3 = createS3Client("PRIVATE");

/** S3 client for public storage (videos, backgrounds). */
export const publicS3 = createS3Client("PUBLIC");

/** Private bucket — user attachments, presigned URLs only. Never public. */
export const PRIVATE_STORAGE_BUCKET = process.env.PRIVATE_STORAGE_BUCKET || "brett-private";

/** Public bucket — videos, backgrounds, anonymous read. */
export const PUBLIC_STORAGE_BUCKET = process.env.PUBLIC_STORAGE_BUCKET || "brett-public";

/** @deprecated Use privateS3 or publicS3 */
export const s3 = privateS3;
/** @deprecated Use PRIVATE_STORAGE_BUCKET or PUBLIC_STORAGE_BUCKET */
export const STORAGE_BUCKET = PRIVATE_STORAGE_BUCKET;

if (!process.env.PRIVATE_STORAGE_ENDPOINT && !process.env.STORAGE_ENDPOINT) {
  console.warn("[Storage] PRIVATE_STORAGE_ENDPOINT not set — file uploads will fail. Set it in .env (see .env.example)");
}

export async function uploadToStorage(storageKey: string, body: Buffer, contentType: string): Promise<void> {
  await privateS3.send(
    new PutObjectCommand({
      Bucket: PRIVATE_STORAGE_BUCKET,
      Key: storageKey,
      Body: body,
      ContentType: contentType,
    })
  );
}

export async function getPresignedUrl(storageKey: string, filename?: string): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: PRIVATE_STORAGE_BUCKET,
    Key: storageKey,
    ResponseContentDisposition: filename
      ? `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`
      : "attachment",
  });
  return getSignedUrl(privateS3, command, { expiresIn: 3600 }); // 1 hour
}
