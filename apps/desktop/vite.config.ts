import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const pkg = require("./package.json");

const ReactCompilerConfig = {};

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
