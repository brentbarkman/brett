import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
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

export const STORAGE_BUCKET = process.env.STORAGE_BUCKET || "brett";

if (!process.env.STORAGE_ENDPOINT) {
  console.warn("[Storage] STORAGE_ENDPOINT not set — file uploads will fail. Set it in .env (see .env.example)");
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
