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

download.get("/", async (c) => {
  const { releasesUrl, videoFiles } = getStorageUrls();
  const latest = await getLatestVersion();
  const version = latest.version;
  const artifactKey = latest.artifact || latest.dmg || `Brett-${version}.zip`;

  // Escape all interpolated values for safe HTML embedding
  const safeVersion = escapeHtml(version);
  const safeDownloadHref = escapeHtml(`${releasesUrl}/${artifactKey}`);
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
      background: linear-gradient(135deg, #f59e0b, #d97706);
      border-radius: 16px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 28px;
      font-weight: 800;
      color: white;
      box-shadow: 0 0 40px rgba(245, 158, 11, 0.25);
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
    .download-btn {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      padding: 14px 32px;
      background: #3b82f6;
      border: none;
      border-radius: 10px;
      color: white;
      font-size: 16px;
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
    .download-btn svg {
      width: 18px;
      height: 18px;
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
  <div class="logo">B</div>
  <div class="app-name">Brett</div>
  <div class="tagline">Your day, handled.</div>

  <a href="${safeDownloadHref}" class="download-btn" id="download-link">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
      <polyline points="7 10 12 15 17 10"/>
      <line x1="12" y1="15" x2="12" y2="3"/>
    </svg>
    <span id="download-text">Download for macOS</span>
  </a>
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
