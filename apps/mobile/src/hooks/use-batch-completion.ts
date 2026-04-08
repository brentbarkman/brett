import { useRef, useState, useCallback } from 'react';

export function useBatchCompletion(toggleItem: (id: string) => void) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [shouldReflow, setShouldReflow] = useState(true);

  const batchToggle = useCallback((id: string) => {
    toggleItem(id);
    setShouldReflow(false);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setShouldReflow(true), 1500);
  }, [toggleItem]);

  return { batchToggle, shouldReflow };
}
