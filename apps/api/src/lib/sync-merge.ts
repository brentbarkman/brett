export interface MergeResult {
  mergedFields: Record<string, unknown>;
  conflictedFields: string[];
  hasChanges: boolean;
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
