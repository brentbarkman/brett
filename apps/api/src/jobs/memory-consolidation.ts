import { prisma } from "../lib/prisma.js";
import { runConsolidation } from "@brett/ai";

const CONSOLIDATION_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours
const STARTUP_DELAY = 60_000; // 60 seconds after startup

export function startMemoryConsolidation(): void {
  // Initial run after startup delay
  setTimeout(() => {
    runConsolidation(prisma).catch((err) =>
      console.error("[memory-consolidation] Initial run failed:", err),
    );

    // Schedule recurring runs
    setInterval(() => {
      runConsolidation(prisma).catch((err) =>
        console.error("[memory-consolidation] Scheduled run failed:", err),
      );
    }, CONSOLIDATION_INTERVAL);
  }, STARTUP_DELAY);

  console.log("[memory-consolidation] Scheduled (first run in 60s, then every 24h)");
}
