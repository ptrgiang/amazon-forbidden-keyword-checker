/** Runtime message contracts between popup/options/content and background. */

export type BgRequest =
  | { type: 'refresh' }
  | { type: 'getSyncStatus' }
  | { type: 'openOptions'; tab?: 'keywords' | 'sites'; keyword?: string };

export interface RefreshResult {
  ok: boolean;
  error?: string;
  keywordCount?: number;
  languages?: string[];
  syncedAt?: number;
}

/** Broadcast from background to tabs after a context-menu scan request. */
export interface ScanSelectionMessage {
  type: 'afkc.scanSelection';
  text?: string;
}

export function isScanSelectionMessage(m: unknown): m is ScanSelectionMessage {
  return (
    typeof m === 'object' &&
    m !== null &&
    (m as { type?: unknown }).type === 'afkc.scanSelection'
  );
}
