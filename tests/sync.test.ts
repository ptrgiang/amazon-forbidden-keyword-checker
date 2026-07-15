import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KEYS } from '../src/lib/storage';
import { syncFromSheet } from '../src/background/sync';

/** In-memory chrome.storage.local double. */
function installChromeMock(): Record<string, unknown> {
  const store: Record<string, unknown> = {};
  (globalThis as Record<string, unknown>).chrome = {
    storage: {
      local: {
        get: async (keys: string[]) => {
          const out: Record<string, unknown> = {};
          for (const k of keys) if (k in store) out[k] = store[k];
          return out;
        },
        set: async (items: Record<string, unknown>) => {
          Object.assign(store, items);
        }
      }
    }
  };
  return store;
}

function response(body: ArrayBuffer | string, init: { status?: number; type?: string } = {}): Response {
  return new Response(body, {
    status: init.status ?? 200,
    headers: { 'content-type': init.type ?? 'application/octet-stream' }
  });
}

describe('syncFromSheet', () => {
  let store: Record<string, unknown>;

  beforeEach(() => {
    store = installChromeMock();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('stores parsed data from a valid CSV response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      response('English,Spanish\ncure,cura', { type: 'text/csv' })
    ));
    const outcome = await syncFromSheet();
    expect(outcome.ok).toBe(true);
    const remote = store[KEYS.remote] as { keywords: unknown[]; languages: string[]; format: string };
    expect(remote.keywords).toHaveLength(2);
    expect(remote.languages).toEqual(['English', 'Spanish']);
    expect(remote.format).toBe('csv');
    expect((store[KEYS.syncStatus] as { state: string }).state).toBe('ok');
  });

  it('never replaces a valid cache when refresh fails', async () => {
    // Seed a valid cache first.
    vi.stubGlobal('fetch', vi.fn(async () => response('English\ncure', { type: 'text/csv' })));
    await syncFromSheet();
    const cached = store[KEYS.remote];
    expect(cached).toBeTruthy();

    vi.stubGlobal('fetch', vi.fn(async () => response('nope', { status: 500 })));
    const outcome = await syncFromSheet();
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toMatch(/500/);
    // Cache untouched.
    expect(store[KEYS.remote]).toBe(cached);
    expect((store[KEYS.syncStatus] as { state: string }).state).toBe('error');
  });

  it('rejects HTML masquerading as data on both endpoints (first install)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      response('<html><body>accounts.google.com login</body></html>', { type: 'text/html' })
    ));
    const outcome = await syncFromSheet();
    expect(outcome.ok).toBe(false);
    expect(store[KEYS.remote]).toBeUndefined();
    expect((store[KEYS.syncStatus] as { state: string }).state).toBe('error');
  });

  it('rejects an empty response body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response(new ArrayBuffer(0))));
    const outcome = await syncFromSheet();
    expect(outcome.ok).toBe(false);
    expect(store[KEYS.remote]).toBeUndefined();
  });
});
