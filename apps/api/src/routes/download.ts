import { Hono } from "hono";
import { getStorageUrls, getLatestVersion } from "../lib/storage-urls.js";

const download = new Hono();

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Validates electron-builder release filenames. Accepts multi-segment arch
// suffixes like `-arm64` or `-arm64-mac` (the `-` is in the character class
// explicitly). Must stay in sync with ALLOWED_RELEASE_PATTERNS in release-proxy.ts.
const FILENAME_PATTERN = /^Brett-[\d.]+(?:-[\w.-]+)?\.(zip|dmg)$/;

function pickFilename(rawKey: string | undefined, fallback: string): string {
  if (!rawKey) return fallback;
  const stripped = rawKey.replace(/^releases\//, "");
  return FILENAME_PATTERN.test(stripped) ? stripped : fallback;
}

download.get("/", async (c) => {
  const { releasesUrl, videoFiles } = getStorageUrls();
  const latest = await getLatestVersion();
  const version = latest.version;

  // Per-arch DMG URLs. Falls back to the legacy `artifact` field for the
  // primary button if `downloads` is missing (e.g. latest.json from an older
  // release). If both are missing, we still link to the autoupdate ZIP by
  // convention so the page never 404s the user.
  const arm64Key = latest.downloads?.arm64;
  const x64Key = latest.downloads?.x64;
  const legacyKey = latest.artifact || latest.dmg;

  const arm64File = pickFilename(arm64Key ?? legacyKey, `Brett-${version}-arm64.dmg`);
  const x64File = pickFilename(x64Key, `Brett-${version}-x64.dmg`);

  // Escape all interpolated values for safe HTML embedding
  const safeVersion = escapeHtml(version);
  const safeArm64Href = escapeHtml(`${releasesUrl}/${arm64File}`);
  const safeX64Href = escapeHtml(`${releasesUrl}/${x64File}`);
  // Escape </script> in JSON to prevent early script tag termination
  const safeVideoJson = JSON.stringify(videoFiles).replace(/<\//g, "<\\/");

  return c.html(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Brett — Download</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: #000;
      color: white;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
    }
    .video-bg {
      position: fixed;
      inset: 0;
      z-index: 0;
    }
    .video-bg video {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      object-fit: cover;
      transition: opacity 1200ms ease-out;
    }
    .download-card {
      position: relative;
      z-index: 10;
      text-align: center;
      padding: 48px 40px;
      border-radius: 16px;
      background: rgba(0, 0, 0, 0.4);
      backdrop-filter: blur(48px);
      -webkit-backdrop-filter: blur(48px);
      border: 1px solid rgba(255, 255, 255, 0.1);
      max-width: 420px;
      width: 90%;
      animation: cardEnter 600ms cubic-bezier(0.16, 1, 0.3, 1) forwards;
      opacity: 0;
    }
    @keyframes cardEnter {
      from { opacity: 0; transform: translateY(16px) scale(0.97); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }
    .logo {
      width: 64px;
      height: 64px;
      margin: 0 auto 20px;
      display: block;
      filter: drop-shadow(0 0 40px rgba(245, 158, 11, 0.25));
    }
    .app-name {
      font-size: 32px;
      font-weight: 700;
      color: white;
      margin-bottom: 8px;
      letter-spacing: -0.02em;
    }
    .tagline {
      color: rgba(255, 255, 255, 0.5);
      font-size: 16px;
      margin-bottom: 32px;
    }
    .downloads {
      display: flex;
      flex-direction: column;
      gap: 10px;
      align-items: stretch;
    }
    .download-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      padding: 14px 24px;
      background: #3b82f6;
      border: none;
      border-radius: 10px;
      color: white;
      font-size: 15px;
      font-weight: 600;
      cursor: pointer;
      transition: all 200ms ease;
      text-decoration: none;
    }
    .download-btn:hover {
      background: #2563eb;
      transform: translateY(-1px);
      box-shadow: 0 4px 20px rgba(59, 130, 246, 0.4);
    }
    .download-btn.secondary {
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid rgba(255, 255, 255, 0.1);
      color: rgba(255, 255, 255, 0.85);
    }
    .download-btn.secondary:hover {
      background: rgba(255, 255, 255, 0.1);
      box-shadow: none;
    }
    .download-btn .btn-sub {
      font-size: 12px;
      font-weight: 500;
      opacity: 0.7;
      margin-left: 4px;
    }
    .download-btn svg {
      width: 16px;
      height: 16px;
      flex-shrink: 0;
    }
    .arch-hint {
      color: rgba(255, 255, 255, 0.35);
      font-size: 12px;
      margin-top: 12px;
      line-height: 1.5;
    }
    .version-info {
      color: rgba(255, 255, 255, 0.3);
      font-size: 12px;
      margin-top: 16px;
    }
    .platform-note {
      color: rgba(255, 255, 255, 0.35);
      font-size: 13px;
      margin-top: 24px;
      padding-top: 20px;
      border-top: 1px solid rgba(255, 255, 255, 0.08);
    }
  </style>
</head>
<body>

<div class="video-bg">
  <video id="vid-a" muted playsinline preload="auto" autoplay></video>
  <video id="vid-b" muted playsinline preload="auto" style="opacity:0"></video>
</div>

<div class="download-card">
  <svg class="logo" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" aria-label="Brett">
    <defs>
      <linearGradient id="gold" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#F5D96B"/>
        <stop offset="40%" stop-color="#E8B931"/>
        <stop offset="100%" stop-color="#B8891A"/>
      </linearGradient>
      <linearGradient id="barHighlight" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#FBE88A" stop-opacity="0.6"/>
        <stop offset="35%" stop-color="#F5D96B" stop-opacity="0"/>
      </linearGradient>
      <radialGradient id="sphere1" cx="38%" cy="35%" r="55%">
        <stop offset="0%" stop-color="#FBE88A"/>
        <stop offset="40%" stop-color="#E8B931"/>
        <stop offset="100%" stop-color="#A67B10"/>
      </radialGradient>
      <radialGradient id="sphere2" cx="38%" cy="35%" r="55%">
        <stop offset="0%" stop-color="#D4B060"/>
        <stop offset="40%" stop-color="#BF9A28"/>
        <stop offset="100%" stop-color="#8A6A10"/>
      </radialGradient>
      <radialGradient id="sphere3" cx="38%" cy="35%" r="55%">
        <stop offset="0%" stop-color="#A89050"/>
        <stop offset="40%" stop-color="#917A20"/>
        <stop offset="100%" stop-color="#6B5510"/>
      </radialGradient>
      <radialGradient id="bg" cx="50%" cy="44%" r="60%">
        <stop offset="0%" stop-color="#181C2A"/>
        <stop offset="100%" stop-color="#0C0F15"/>
      </radialGradient>
      <radialGradient id="vignette" cx="50%" cy="46%" r="58%">
        <stop offset="0%" stop-color="black" stop-opacity="0"/>
        <stop offset="75%" stop-color="black" stop-opacity="0"/>
        <stop offset="100%" stop-color="black" stop-opacity="0.35"/>
      </radialGradient>
      <radialGradient id="warmth" cx="52%" cy="50%" r="38%">
        <stop offset="0%" stop-color="#E8B931" stop-opacity="0.14"/>
        <stop offset="60%" stop-color="#E8B931" stop-opacity="0.05"/>
        <stop offset="100%" stop-color="#E8B931" stop-opacity="0"/>
      </radialGradient>
      <radialGradient id="innerGlow" cx="48%" cy="50%" r="25%">
        <stop offset="0%" stop-color="#E8B931" stop-opacity="0.08"/>
        <stop offset="100%" stop-color="#E8B931" stop-opacity="0"/>
      </radialGradient>
      <linearGradient id="borderGold" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#F5D96B" stop-opacity="0.5"/>
        <stop offset="50%" stop-color="#C49A1A" stop-opacity="0.2"/>
        <stop offset="100%" stop-color="#F2D04A" stop-opacity="0.4"/>
      </linearGradient>
    </defs>
    <rect width="512" height="512" rx="112" fill="url(#bg)"/>
    <rect width="512" height="512" rx="112" fill="url(#vignette)"/>
    <rect width="512" height="512" rx="112" fill="url(#warmth)"/>
    <rect width="512" height="512" rx="112" fill="url(#innerGlow)"/>
    <ellipse cx="256" cy="45" rx="140" ry="35" fill="white" opacity="0.012"/>
    <rect x="1.5" y="1.5" width="509" height="509" rx="111" fill="none" stroke="url(#borderGold)" stroke-width="2"/>
    <circle cx="135" cy="170" r="28" fill="url(#sphere1)"/>
    <rect x="191" y="159" width="196" height="22" rx="11" fill="url(#gold)"/>
    <rect x="191" y="159" width="196" height="10" rx="5" fill="url(#barHighlight)"/>
    <g opacity="0.75">
      <circle cx="135" cy="256" r="28" fill="url(#sphere2)"/>
      <rect x="191" y="245" width="155" height="22" rx="11" fill="url(#gold)"/>
      <rect x="191" y="245" width="155" height="10" rx="5" fill="url(#barHighlight)"/>
    </g>
    <g opacity="0.45">
      <circle cx="135" cy="342" r="28" fill="url(#sphere3)"/>
      <rect x="191" y="331" width="108" height="22" rx="11" fill="url(#gold)"/>
      <rect x="191" y="331" width="108" height="10" rx="5" fill="url(#barHighlight)"/>
    </g>
  </svg>
  <div class="app-name">Brett</div>
  <div class="tagline">Your day, handled.</div>

  <div class="downloads">
    <a href="${safeArm64Href}" class="download-btn">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
        <polyline points="7 10 12 15 17 10"/>
        <line x1="12" y1="15" x2="12" y2="3"/>
      </svg>
      <span>Apple Silicon</span>
      <span class="btn-sub">M1 and later</span>
    </a>
    <a href="${safeX64Href}" class="download-btn secondary">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
        <polyline points="7 10 12 15 17 10"/>
        <line x1="12" y1="15" x2="12" y2="3"/>
      </svg>
      <span>Intel</span>
    </a>
  </div>
  <div class="arch-hint">Not sure? Pick Apple Silicon if your Mac is from late 2020 or later.</div>
  <div class="version-info">v${safeVersion} · macOS 12+</div>

  <div class="platform-note" id="platform-note" style="display:none">
    <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14" style="display:inline-block;vertical-align:-2px;margin-right:4px;opacity:0.5"><path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/></svg>
    Brett is currently available for macOS
  </div>
</div>

<script>
  var videos = ${safeVideoJson};
  var current = Math.floor(Math.random() * videos.length);
  var vidA = document.getElementById('vid-a');
  var vidB = document.getElementById('vid-b');
  var activeSlot = vidA;

  vidA.src = videos[current];
  vidA.play().catch(function() {});

  function nextVideo(e) {
    if (e && e.target !== activeSlot) return;
    current = (current + 1) % videos.length;
    var inactive = activeSlot === vidA ? vidB : vidA;
    inactive.src = videos[current];
    inactive.play().catch(function() {});
    inactive.style.opacity = '1';
    activeSlot.style.opacity = '0';
    activeSlot = inactive;
  }

  vidA.addEventListener('ended', nextVideo);
  vidB.addEventListener('ended', nextVideo);

  var isMac = /Mac|iPhone|iPad/.test(navigator.userAgent);
  if (!isMac) {
    document.getElementById('platform-note').style.display = 'block';
  }
</script>

</body>
</html>`);
});

export { download };
