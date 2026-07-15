import { parseCsv } from '../lib/csv';
import { looksLikeHtml, parseKeywordGrid } from '../lib/parser';
import { saveRemote, saveSyncStatus } from '../lib/storage';
import type { RemoteDataset } from '../lib/types';
import { CSV_URL } from '../lib/types';

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

class FetchError extends Error {}

async function download(url: string): Promise<{ bytes: ArrayBuffer; contentType: string }> {
  let res: Response;
  try {
    res = await fetch(url, { credentials: 'omit', redirect: 'follow' });
  } catch (e) {
    throw new FetchError(`Network error: ${(e as Error).message}`);
  }
  if (!res.ok) {
    throw new FetchError(`HTTP ${res.status} ${res.statusText}`);
  }
  const contentType = res.headers.get('content-type') ?? '';
  const bytes = await res.arrayBuffer();
  if (bytes.byteLength === 0) throw new FetchError('Empty response body');
  return { bytes, contentType };
}

async function tryCsv(): Promise<RemoteDataset> {
  const { bytes, contentType } = await download(CSV_URL);
  if (contentType.includes('text/html') || looksLikeHtml(bytes)) {
    throw new FetchError('Got an HTML page (sheet not public or login required)');
  }
  const text = new TextDecoder('utf-8').decode(bytes);
  const grid = parseCsv(text);
  const parsed = parseKeywordGrid(grid);
  return {
    ...parsed,
    syncedAt: Date.now(),
    sourceUrl: CSV_URL,
    sourceHash: await sha256Hex(bytes),
    format: 'csv'
  };
}

export interface SyncOutcome {
  ok: boolean;
  error?: string;
  dataset?: RemoteDataset;
}

/**
 * Fetch + validate + parse the sheet.
 * On any failure the existing cache is left untouched.
 */
export async function syncFromSheet(): Promise<SyncOutcome> {
  await saveSyncStatus({ state: 'syncing', lastAttemptAt: Date.now() });
  try {
    const dataset = await tryCsv();
    await saveRemote(dataset);
    await saveSyncStatus({ state: 'ok', lastAttemptAt: Date.now() });
    return { ok: true, dataset };
  } catch (e) {
    const error = (e as Error).message;
    await saveSyncStatus({ state: 'error', lastError: error, lastAttemptAt: Date.now() });
    return { ok: false, error };
  }
}
