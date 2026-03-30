import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { execSync } from "child_process";
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
const DESKTOP_DIR = path.resolve(__dirname, "../apps/desktop");

async function release() {
  // 1. Read version from package.json
  const pkg = JSON.parse(fs.readFileSync(path.join(DESKTOP_DIR, "package.json"), "utf-8"));
  const version = pkg.version;
  console.log(`Building Brett v${version}...\n`);

  // 2. Build the desktop app
  console.log("Running electron:build...");
  execSync("pnpm --filter @brett/desktop electron:build", {
    stdio: "inherit",
    cwd: path.resolve(__dirname, ".."),
  });

  // 3. Find the .dmg and latest-mac.yml
  const distDir = path.join(DESKTOP_DIR, "dist");
  const dmgFiles = fs.readdirSync(distDir).filter((f) => f.endsWith(".dmg"));
  if (dmgFiles.length === 0) {
    throw new Error("No .dmg file found in dist/. Build may have failed.");
  }
  const dmgFile = dmgFiles[0];
  const dmgPath = path.join(distDir, dmgFile);

  const ymlPath = path.join(distDir, "latest-mac.yml");
  if (!fs.existsSync(ymlPath)) {
    throw new Error("latest-mac.yml not found in dist/. electron-builder may not have generated it.");
  }

  // 4. Upload .dmg
  const dmgKey = `releases/Brett-${version}.dmg`;
  const dmgBody = fs.readFileSync(dmgPath);
  console.log(`\nUploading ${dmgFile} (${(dmgBody.length / 1024 / 1024).toFixed(1)} MB) → ${dmgKey}`);
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: dmgKey,
      Body: dmgBody,
      ContentType: "application/octet-stream",
      ACL: "public-read",
    })
  );
  console.log("  ✓ DMG uploaded");

  // 5. Upload latest-mac.yml
  const ymlKey = "releases/latest-mac.yml";
  const ymlBody = fs.readFileSync(ymlPath);
  console.log(`Uploading latest-mac.yml → ${ymlKey}`);
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: ymlKey,
      Body: ymlBody,
      ContentType: "text/yaml",
      ACL: "public-read",
    })
  );
  console.log("  ✓ latest-mac.yml uploaded");

  // 6. Summary
  const endpoint = process.env.STORAGE_ENDPOINT || "";
  console.log(`\n✓ Release v${version} published!`);
  console.log(`  Download: ${endpoint}/${BUCKET}/${dmgKey}`);
  console.log(`  Manifest: ${endpoint}/${BUCKET}/${ymlKey}`);
}

release().catch((err) => {
  console.error("Release failed:", err);
  process.exit(1);
});
