import type { QueryClient } from "@tanstack/react-query";

/** Invalidate all thing-related queries after a mutation */
export function invalidateAllThings(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: ["things"] });
  qc.invalidateQueries({ queryKey: ["thing-detail"] });
  qc.invalidateQueries({ queryKey: ["inbox"] });
  qc.invalidateQueries({ queryKey: ["lists"] });
  qc.invalidateQueries({ queryKey: ["scout-findings"] });
}
