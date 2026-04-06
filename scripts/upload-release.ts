import { PutObjectCommand } from "@aws-sdk/client-s3";
import fs from "fs";
import path from "path";
import { releaseS3, RELEASE_BUCKET } from "./s3";

const DESKTOP_DIR = path.resolve(__dirname, "../apps/desktop");

async function uploadRelease() {
  if (!process.env.RELEASE_STORAGE_ENDPOINT && !process.env.STORAGE_ENDPOINT) {
    throw new Error("RELEASE_STORAGE_ENDPOINT (or STORAGE_ENDPOINT) not set");
  }

  // Read version from package.json
  const pkg = JSON.parse(fs.readFileSync(path.join(DESKTOP_DIR, "package.json"), "utf-8"));
  const version = pkg.version;
  console.log(`Uploading Brett v${version} release artifacts...\n`);

  // Find the .dmg
  const distDir = path.join(DESKTOP_DIR, "dist");
  const dmgFiles = fs.readdirSync(distDir).filter((f) => f.endsWith(".dmg"));
  if (dmgFiles.length === 0) {
    throw new Error("No .dmg found in dist/. Build may have failed.");
  }
  const dmgFile = dmgFiles[0];
  if (!dmgFile.includes(version)) {
    throw new Error(`DMG filename "${dmgFile}" does not contain expected version "${version}". Stale build artifact?`);
  }
  const dmgPath = path.join(distDir, dmgFile);

  // Find latest-mac.yml (contains SHA512 hash — do not modify)
  const ymlPath = path.join(distDir, "latest-mac.yml");
  if (!fs.existsSync(ymlPath)) {
    throw new Error("latest-mac.yml not found in dist/.");
  }

  // Upload .dmg
  const dmgKey = `releases/Brett-${version}.dmg`;
  const dmgBody = fs.readFileSync(dmgPath);
  console.log(`Uploading ${dmgFile} (${(dmgBody.length / 1024 / 1024).toFixed(1)} MB) → ${dmgKey}`);
  await releaseS3.send(
    new PutObjectCommand({
      Bucket: RELEASE_BUCKET,
      Key: dmgKey,
      Body: dmgBody,
      ContentType: "application/octet-stream",
      ACL: "public-read",
    })
  );
  console.log("  ✓ DMG uploaded");

  // Upload latest-mac.yml
  const ymlKey = "releases/latest-mac.yml";
  const ymlBody = fs.readFileSync(ymlPath);
  console.log(`Uploading latest-mac.yml → ${ymlKey}`);
  await releaseS3.send(
    new PutObjectCommand({
      Bucket: RELEASE_BUCKET,
      Key: ymlKey,
      Body: ymlBody,
      ContentType: "text/yaml",
      ACL: "public-read",
    })
  );
  console.log("  ✓ latest-mac.yml uploaded");

  // Upload latest.json
  const latestKey = "releases/latest.json";
  const latestBody = JSON.stringify({ version, dmg: dmgKey });
  console.log(`Uploading latest.json → ${latestKey}`);
  await releaseS3.send(
    new PutObjectCommand({
      Bucket: RELEASE_BUCKET,
      Key: latestKey,
      Body: latestBody,
      ContentType: "application/json",
      ACL: "public-read",
    })
  );
  console.log("  ✓ latest.json uploaded");

  const endpoint = process.env.RELEASE_STORAGE_ENDPOINT || process.env.STORAGE_ENDPOINT;
  console.log(`\n✓ Release v${version} uploaded!`);
  console.log(`  Download: ${endpoint}/${RELEASE_BUCKET}/${dmgKey}`);
}

uploadRelease().catch((err) => {
  console.error("Upload failed:", err);
  process.exit(1);
});
