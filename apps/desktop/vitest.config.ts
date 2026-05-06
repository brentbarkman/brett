import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const pkg = require("./package.json");

export default defineConfig({
  plugins: [react()],
  // Mirror the `define` from vite.config.ts so `__APP_VERSION__` is
  // substituted in test runs. Without this, modules that read the macro
  // (diagnostics.ts, settings/UpdatesSection.tsx) ReferenceError at import.
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    // Force every import of `react` / `react-dom` to resolve to a single
    // instance. Defensive against transitive deps that ship their own React
    // (lucide-react@0.522.0 declares `react: 18.2.0` in its `dependencies`,
    // which would install a nested React 18 copy without the pnpm override
    // in the root package.json). Vite dev/build does this automatically;
    // Vitest does not.
    dedupe: ["react", "react-dom"],
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/__tests__/setup.ts"],
  },
});
