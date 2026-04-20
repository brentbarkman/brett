import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const pkg = require("./package.json");

// React Compiler disabled: the prod-mode minified bundle silently corrupted
// the fiber tree so React Router's popstate subscriber never fired re-renders
// (clicks updated URL but view stayed). Dev Electron was fine because the
// dev build pipeline runs the compiler differently. Reproduced by running
// `electron dist/electron/main.js` (prod mode, app:// protocol) with the
// compiler on vs off — off worked, on broke. Re-enable once the specific
// pattern it mis-optimizes is isolated.
const ReactCompilerConfig = {};
const REACT_COMPILER_ENABLED = false;

export default defineConfig({
  plugins: [
    react({
      babel: {
        plugins: REACT_COMPILER_ENABLED
          ? [["babel-plugin-react-compiler", ReactCompilerConfig]]
          : [],
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
