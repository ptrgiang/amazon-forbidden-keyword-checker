import { useCallback, useEffect, useState } from 'react';
import { KEYS, loadState, type StoredState } from '../lib/storage';

/**
 * Live view over chrome.storage.local: loads once, then follows
 * storage.onChanged so popup/options always show current data.
 */
export function useExtensionState(): { state: StoredState | null; reload: () => void } {
  const [state, setState] = useState<StoredState | null>(null);

  const reload = useCallback(() => {
    void loadState().then(setState);
  }, []);

  useEffect(() => {
    reload();
    const listener = (
      changes: { [key: string]: chrome.storage.StorageChange },
      area: string
    ): void => {
      if (area !== 'local') return;
      if (Object.keys(changes).some((k) => k.startsWith('afkc.'))) reload();
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, [reload]);

  return { state, reload };
}

export { KEYS };
