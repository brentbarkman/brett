import { PutObjectCommand } from "@aws-sdk/client-s3";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { s3, BUCKET } from "./s3";

const DESKTOP_DIR = path.resolve(__dirname, "../apps/desktop");

async function release() {
  if (!process.env.STORAGE_ENDPOINT) {
    throw new Error("STORAGE_ENDPOINT not set. Set it in your environment before running release.");
  }

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
  const dmgFile = `Brett-${version}.dmg`;
  const dmgPath = path.join(distDir, dmgFile);
  if (!fs.existsSync(dmgPath)) {
    throw new Error(`Expected ${dmgFile} not found in dist/. Build may have failed.`);
  }

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

  // 6. Upload latest.json (used by download page to auto-detect version)
  const latestKey = "releases/latest.json";
  const latestBody = JSON.stringify({ version, dmg: dmgKey });
  console.log(`Uploading latest.json → ${latestKey}`);
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: latestKey,
      Body: latestBody,
      ContentType: "application/json",
      ACL: "public-read",
    })
  );
  console.log("  ✓ latest.json uploaded");

  // 7. Summary
  const endpoint = process.env.STORAGE_ENDPOINT;
  console.log(`\n✓ Release v${version} published!`);
  console.log(`  Download: ${endpoint}/${BUCKET}/${dmgKey}`);
  console.log(`  Manifest: ${endpoint}/${BUCKET}/${ymlKey}`);
}

release().catch((err) => {
  console.error("Release failed:", err);
  process.exit(1);
});
