import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const pkg = require("./package.json");

// React Compiler disabled. v1.0.0 mis-optimizes the packaged prod bundle
// (minified, served over app://): closure hoisting detaches
// useSyncExternalStore subscribers, silently killing React Router's popstate
// listener so clicks update the URL but the view never re-renders. Console
// stays clean, which makes this a nightmare to catch.
//
// We tried `compilationMode: "annotation"` as a compromise — only files with
// `"use memo";` get compiled — and it still broke navigation in the packaged
// build even with no files annotated. The plugin is not a no-op just because
// nothing opts in. Until upstream ships fixes for facebook/react#35342,
// #36128, #34045, #35009, the compiler stays off entirely. Hand-written
// useMemo / useCallback / React.memo is fine where it measurably helps.
export default defineConfig({
  plugins: [react()],
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
    // esbuild's minifier mangles something in React Router v7's useSyncExternalStore
    // subscribe closure — the popstate listener never attaches in the packaged
    // `app://` bundle, so clicks update the URL but the view doesn't re-render.
    // Dev works because Vite's dev pipeline doesn't minify. Disabling minify here
    // trades ~3 MB of bundle size for a working router. Revisit with a targeted
    // minification config (exclude react-router-dom / history, or switch to terser
    // with safer options) once we have time to isolate the exact rule that breaks.
    minify: false,
  },
});
