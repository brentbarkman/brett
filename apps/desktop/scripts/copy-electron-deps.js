/**
 * Copy production dependencies (and their full transitive tree) from the
 * hoisted workspace root node_modules into apps/desktop/node_modules.
 *
 * electron-builder's pnpm detection doesn't reliably resolve hoisted
 * transitive deps. This script ensures they're all local before packaging.
 */
const fs = require("fs");
const path = require("path");

const desktopDir = path.resolve(__dirname, "..");
const rootModules = path.resolve(desktopDir, "../../node_modules");
const localModules = path.resolve(desktopDir, "node_modules");

// Only the electron main process deps (renderer is bundled by Vite)
const ELECTRON_DEPS = ["electron-store", "electron-updater", "sql.js"];

const copied = new Set();

function copyDep(name) {
  if (copied.has(name)) return;
  copied.add(name);

  const src = path.join(rootModules, name);
  const dst = path.join(localModules, name);

  if (!fs.existsSync(src)) {
    // Check if it's a Node builtin
    try { require.resolve(name); return; } catch { }
    console.warn(`  ⚠ ${name} not found in root node_modules (may be builtin)`);
    return;
  }

  if (fs.existsSync(dst)) {
    // Already exists (might be a workspace symlink) — check if it's real
    const stat = fs.lstatSync(dst);
    if (stat.isSymbolicLink()) {
      fs.unlinkSync(dst);
    } else {
      return; // Real directory, already copied
    }
  }

  fs.cpSync(src, dst, { recursive: true });

  // Recurse into this package's dependencies
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(src, "package.json"), "utf-8"));
    for (const dep of Object.keys(pkg.dependencies || {})) {
      if (!dep.startsWith("@types/")) {
        copyDep(dep);
      }
    }
  } catch { }
}

console.log("Copying electron main process deps to local node_modules...");
fs.mkdirSync(localModules, { recursive: true });

for (const dep of ELECTRON_DEPS) {
  copyDep(dep);
}

console.log(`Copied ${copied.size} packages`);
