import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export const s3 = new S3Client({
  endpoint: process.env.STORAGE_ENDPOINT,
  region: process.env.STORAGE_REGION || "us-east-1",
  credentials: {
    accessKeyId: process.env.STORAGE_ACCESS_KEY || "",
    secretAccessKey: process.env.STORAGE_SECRET_KEY || "",
  },
  forcePathStyle: true,
});

/** Private bucket — user attachments, presigned URLs only. Never public. */
export const PRIVATE_STORAGE_BUCKET = process.env.PRIVATE_STORAGE_BUCKET || "brett-private";

/** @deprecated Use PRIVATE_STORAGE_BUCKET or PUBLIC_STORAGE_BUCKET instead */
export const STORAGE_BUCKET = PRIVATE_STORAGE_BUCKET;

if (!process.env.STORAGE_ENDPOINT) {
  console.warn("[Storage] STORAGE_ENDPOINT not set — file uploads will fail. Set it in .env (see .env.example)");
}

export async function uploadToStorage(storageKey: string, body: Buffer, contentType: string): Promise<void> {
  await s3.send(
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
    Bucket: STORAGE_BUCKET,
    Key: storageKey,
    ResponseContentDisposition: filename
      ? `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`
      : "attachment",
  });
  return getSignedUrl(s3, command, { expiresIn: 3600 }); // 1 hour
}
