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

// Post-pass: `cpSync` brings along nested node_modules for packages that
// had them in the root (pnpm pins older versions nested under their
// parent). Those nested packages reference deps that the initial pass
// missed — e.g. `p-locate/node_modules/p-limit@2` requires `p-try`, but
// the hoisted `p-limit@3` we copied from root doesn't declare p-try, so
// the recursion never sees it. Walk every package.json under the copy
// target and make sure each declared dep is resolvable (either nested
// next to the consumer or flat at the top of localModules).
function ensureDepsResolvable(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    // Handle scoped packages (@foo/bar) — recurse one level
    if (entry.name.startsWith("@")) {
      ensureDepsResolvable(path.join(dir, entry.name));
      continue;
    }
    const pkgRoot = path.join(dir, entry.name);
    const pkgPath = path.join(pkgRoot, "package.json");
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
        for (const dep of Object.keys(pkg.dependencies || {})) {
          if (dep.startsWith("@types/")) continue;
          const nestedPath = path.join(pkgRoot, "node_modules", dep);
          const topPath = path.join(localModules, dep);
          if (!fs.existsSync(nestedPath) && !fs.existsSync(topPath)) {
            copyDep(dep);
          }
        }
      } catch {
        // Malformed package.json — skip
      }
    }
    // Recurse into any nested node_modules
    const nested = path.join(pkgRoot, "node_modules");
    if (fs.existsSync(nested)) ensureDepsResolvable(nested);
  }
}

// Iterate until stable — a newly copied dep may itself have missing
// transitives that the previous pass couldn't see.
let prevCount = -1;
while (copied.size !== prevCount) {
  prevCount = copied.size;
  ensureDepsResolvable(localModules);
}

console.log(`Copied ${copied.size} packages`);
