import type { BgRequest, RefreshResult } from '../lib/messages';
import { loadState } from '../lib/storage';
import { syncFromSheet } from './sync';

const MENU_ID = 'afkc-scan-selection';

const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

/**
 * Self-healing sync: runs on install, on browser startup, and on every
 * service-worker wake. Fetches immediately when there is no valid cache
 * (e.g. the install-time fetch failed) and refreshes silently when the
 * cache is older than a day. Failures keep the existing cache and surface
 * a retry state in the popup; nothing crashes.
 */
async function ensureFreshData(): Promise<void> {
  const state = await loadState();
  if (state.syncStatus.state === 'syncing') return;
  if (!state.remote) {
    await syncFromSheet();
    return;
  }
  if (Date.now() - state.remote.syncedAt > STALE_AFTER_MS) {
    void syncFromSheet();
  }
}

chrome.runtime.onInstalled.addListener(() => {
  // removeAll first so reloading/updating the extension never fails with
  // a duplicate-id error.
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ID,
      title: 'Scan selected text',
      contexts: ['selection']
    });
  });
  void ensureFreshData();
});

chrome.runtime.onStartup.addListener(() => {
  void ensureFreshData();
});

// Also on every worker wake: if storage is empty for any reason, this
// repopulates it without user action.
void ensureFreshData();

function sendScanSelection(tabId: number, text = '', frameId?: number): void {
  const callback = (): void => {
    // Swallow "no receiving end" errors on pages without the content script.
    void chrome.runtime.lastError;
  };
  if (frameId === undefined) {
    chrome.tabs.sendMessage(tabId, { type: 'afkc.scanSelection', text }, callback);
  } else {
    chrome.tabs.sendMessage(tabId, { type: 'afkc.scanSelection', text }, { frameId }, callback);
  }
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU_ID || tab?.id === undefined) return;
  // Pass the selection text along: on canvas editors (Google Docs) the
  // page DOM exposes no selection, but Chrome still provides the text here.
  sendScanSelection(tab.id, info.selectionText ?? '', info.frameId);
});

let refreshing: Promise<RefreshResult> | null = null;

async function doRefresh(): Promise<RefreshResult> {
  const outcome = await syncFromSheet();
  if (!outcome.ok || !outcome.dataset) {
    return { ok: false, error: outcome.error };
  }
  return {
    ok: true,
    keywordCount: outcome.dataset.keywords.length,
    languages: outcome.dataset.languages,
    syncedAt: outcome.dataset.syncedAt
  };
}

chrome.runtime.onMessage.addListener((message: BgRequest, _sender, sendResponse) => {
  if (message?.type === 'refresh') {
    if (!refreshing) {
      refreshing = doRefresh().finally(() => {
        refreshing = null;
      });
    }
    refreshing.then(sendResponse);
    return true; // async response
  }
  if (message?.type === 'getSyncStatus') {
    loadState().then((s) => sendResponse(s.syncStatus));
    return true;
  }
  if (message?.type === 'openOptions') {
    const tab = message.tab === 'sites' ? 'sites' : 'keywords';
    const url = new URL(chrome.runtime.getURL('options.html'));
    url.searchParams.set('tab', tab);
    if (tab === 'keywords' && message.keyword?.trim()) {
      url.searchParams.set('keyword', message.keyword.trim());
    }
    void chrome.tabs.create({ url: url.href });
    sendResponse({ ok: true });
    return false;
  }
  return false;
});
