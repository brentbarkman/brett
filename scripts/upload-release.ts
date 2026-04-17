import { PutObjectCommand } from "@aws-sdk/client-s3";
import fs from "fs";
import path from "path";
import { releaseS3, RELEASE_BUCKET } from "./s3";

const DESKTOP_DIR = path.resolve(__dirname, "../apps/desktop");

async function uploadFile(
  localPath: string,
  key: string,
  contentType: string,
  label: string,
) {
  const body = fs.readFileSync(localPath);
  const sizeMb = (body.length / 1024 / 1024).toFixed(1);
  console.log(`Uploading ${label} (${sizeMb} MB) → ${key}`);
  await releaseS3.send(
    new PutObjectCommand({
      Bucket: RELEASE_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
      ACL: "public-read",
    }),
  );
  console.log(`  ✓ ${label} uploaded`);
}

async function uploadRelease() {
  if (!process.env.RELEASE_STORAGE_ENDPOINT && !process.env.STORAGE_ENDPOINT) {
    throw new Error("RELEASE_STORAGE_ENDPOINT (or STORAGE_ENDPOINT) not set");
  }

  const pkg = JSON.parse(fs.readFileSync(path.join(DESKTOP_DIR, "package.json"), "utf-8"));
  const version = pkg.version;
  console.log(`Uploading Brett v${version} release artifacts...\n`);

  const distDir = path.join(DESKTOP_DIR, "dist");
  // electron-builder emits per-arch and universal variants — grab everything
  // matching the Brett-<version> prefix and ending in .dmg or .zip.
  const allArtifacts = fs
    .readdirSync(distDir)
    .filter(
      (f) =>
        (f.endsWith(".zip") || f.endsWith(".dmg")) &&
        f.startsWith("Brett") &&
        f.includes(version),
    );
  if (allArtifacts.length === 0) {
    throw new Error(
      `No .zip or .dmg for version ${version} found in dist/. Build may have failed or produced a stale artifact.`,
    );
  }

  // ZIP is the autoupdate target (Squirrel.Mac can't mount a DMG); DMG is
  // the first-install download. Require at least one ZIP so autoupdate works.
  const zips = allArtifacts.filter((f) => f.endsWith(".zip"));
  const dmgs = allArtifacts.filter((f) => f.endsWith(".dmg"));
  if (zips.length === 0) {
    throw new Error(
      "No .zip artifact produced. Autoupdate cannot work without a zip — check electron-builder mac.target config.",
    );
  }

  const ymlPath = path.join(distDir, "latest-mac.yml");
  if (!fs.existsSync(ymlPath)) {
    throw new Error("latest-mac.yml not found in dist/.");
  }

  // Upload every artifact under its native electron-builder filename.
  // latest-mac.yml references exact names + SHA512 — renaming breaks the updater.
  for (const f of allArtifacts) {
    await uploadFile(
      path.join(distDir, f),
      `releases/${f}`,
      "application/octet-stream",
      f,
    );
  }

  await uploadFile(ymlPath, "releases/latest-mac.yml", "text/yaml", "latest-mac.yml");

  // latest.json points the download page at the preferred first-install artifact:
  // DMG if we produced one, otherwise the ZIP. Autoupdate reads latest-mac.yml,
  // not this file, so it's safe to prefer DMG here.
  const downloadArtifact = dmgs[0] ?? zips[0];
  const latestKey = "releases/latest.json";
  const latestBody = JSON.stringify({
    version,
    artifact: `releases/${downloadArtifact}`,
  });
  console.log(`Uploading latest.json → ${latestKey}`);
  await releaseS3.send(
    new PutObjectCommand({
      Bucket: RELEASE_BUCKET,
      Key: latestKey,
      Body: latestBody,
      ContentType: "application/json",
      ACL: "public-read",
    }),
  );
  console.log("  ✓ latest.json uploaded");

  const endpoint = process.env.RELEASE_STORAGE_ENDPOINT || process.env.STORAGE_ENDPOINT;
  console.log(`\n✓ Release v${version} uploaded!`);
  console.log(`  Download: ${endpoint}/${RELEASE_BUCKET}/releases/${downloadArtifact}`);
}

uploadRelease().catch((err) => {
  console.error("Upload failed:", err);
  process.exit(1);
});
