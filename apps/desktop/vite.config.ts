import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const pkg = require("./package.json");

// React Compiler in annotation mode: only files with a top-of-file
// `"use memo";` directive get compiled. The mid-April "compiler broke nav"
// diagnosis turned out to be wrong (real cause: React 19.2's startTransition
// inside HashRouter — see apps/desktop/src/main.tsx). But running the
// compiler in annotation mode keeps the escape hatch while opt-ins have to
// be made deliberately and verified in the packaged build.
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
