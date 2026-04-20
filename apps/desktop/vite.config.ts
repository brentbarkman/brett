import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const pkg = require("./package.json");

// React Compiler v1.0.0 mis-optimizes the prod-mode minified bundle —
// closure hoisting breaks useSyncExternalStore subscribers, which detaches
// React Router's popstate listener so clicks update the URL but the view
// stays put. Related upstream: facebook/react#35342, #36128, #34045, #35009.
// Dev Electron was unaffected because Vite's dev pipeline runs the compiler
// differently.
//
// Compromise: run the compiler in `annotation` mode. Only files that opt in
// with a top-of-file `"use memo";` directive get compiled. Everything else
// is skipped. We opt in leaf components that benefit from auto-memoization
// and don't touch Router context (ThingCard, InboxItemRow to start).
// Re-audit once a new compiler release ships with the hoisting fixes.
const ReactCompilerConfig = {
  compilationMode: "annotation" as const,
};

export default defineConfig({
  plugins: [
    react({
      babel: {
        plugins: [["babel-plugin-react-compiler", ReactCompilerConfig]],
      },
    }),
  ],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  base: "./",
  server: {
    watch: {
      // Follow symlinks into workspace packages so HMR works across the monorepo
      followSymlinks: true,
    },
    fs: {
      // Allow serving files from workspace packages outside apps/desktop
      allow: [path.resolve(__dirname, "../..")],
    },
  },
  build: {
    outDir: "dist/renderer",
  },
});
