export interface MergeResult {
  mergedFields: Record<string, unknown>;
  conflictedFields: string[];
  hasChanges: boolean;
}

/**
 * List fields the client declared as changed but for which it supplied no
 * `previousValues[field]` baseline. These are unmergeable — we can't tell
 * whether the client's edit is ahead of or stale against the server.
 * Returned so the caller can reject the mutation cleanly instead of silently
 * treating them as conflicts (server-wins), which historically lost edits.
 */
export function findMissingBaselines(
  changedFields: string[],
  previousValues: Record<string, unknown>,
): string[] {
  return changedFields.filter((field) => !(field in previousValues));
}

export function fieldLevelMerge(
  currentRecord: Record<string, unknown>,
  changedFields: string[],
  payload: Record<string, unknown>,
  previousValues: Record<string, unknown>,
): MergeResult {
  const mergedFields: Record<string, unknown> = {};
  const conflictedFields: string[] = [];

  for (const field of changedFields) {
    const serverValue = currentRecord[field];
    const clientPrevValue = previousValues[field];

    // Deep equality via JSON.stringify (handles dates, nulls, objects)
    if (JSON.stringify(serverValue) === JSON.stringify(clientPrevValue)) {
      mergedFields[field] = payload[field];
    } else {
      conflictedFields.push(field);
    }
  }

  return {
    mergedFields,
    conflictedFields,
    hasChanges: Object.keys(mergedFields).length > 0,
  };
}
