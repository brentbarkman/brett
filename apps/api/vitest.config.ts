import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    setupFiles: ["./src/__tests__/setup.ts"],
    server: {
      deps: {
        // voyageai ships broken ESM (directory imports). Force it through CJS.
        inline: ["voyageai"],
      },
    },
  },
});
