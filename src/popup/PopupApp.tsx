import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RefreshResult } from '../lib/messages';
import { activeKeywordCount, allLanguages, mergeKeywords } from '../lib/merge';
import { isSiteEnabled, normalizeSiteHost, saveSettings, setSiteEnabled } from '../lib/storage';
import { SHEET_URL } from '../lib/types';
import { ManualScan } from '../ui/ManualScan';
import { useExtensionState } from '../ui/useExtensionState';

function formatTime(ms: number | undefined): string {
  if (!ms) return 'never';
  return new Date(ms).toLocaleString();
}

export function PopupApp(): JSX.Element {
  const { state } = useExtensionState();
  const [hostname, setHostname] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<{ id: number; url: string } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [langOpen, setLangOpen] = useState(false);
  const langRef = useRef<HTMLDivElement>(null);
  const autoSyncStarted = useRef(false);

  useEffect(() => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const url = tabs[0]?.url;
      const id = tabs[0]?.id;
      if (url && /^https?:/.test(url)) {
        try {
          setHostname(normalizeSiteHost(new URL(url).hostname));
          setActiveTab(typeof id === 'number' ? { id, url } : null);
        } catch {
          setHostname(null);
          setActiveTab(null);
        }
      }
    });
  }, []);

  useEffect(() => {
    const onDocClick = (e: MouseEvent): void => {
      if (langRef.current && e.target instanceof Node && !langRef.current.contains(e.target)) {
        setLangOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const refresh = useCallback((quiet = false): void => {
    setRefreshing(true);
    if (!quiet) setFeedback(null);
    chrome.runtime.sendMessage({ type: 'refresh' }, (result: RefreshResult) => {
      setRefreshing(false);
      if (chrome.runtime.lastError || !result) {
        setFeedback({ kind: 'error', text: 'Could not reach the background worker.' });
        return;
      }
      if (result.ok) {
        if (!quiet) {
          setFeedback({
            kind: 'ok',
            text: `Synced ${result.keywordCount} keywords (${result.languages?.length} languages).`
          });
        }
      } else {
        setFeedback({
          kind: 'error',
          text: `Sync failed - kept previous keywords. ${result.error ?? ''}`
        });
      }
    });
  }, []);

  useEffect(() => {
    if (autoSyncStarted.current) return;
    autoSyncStarted.current = true;
    refresh(true);
  }, [refresh]);

  const merged = useMemo(
    () => (state ? mergeKeywords(state.remote, state.overrides) : []),
    [state]
  );
  const languages = useMemo(
    () => (state ? allLanguages(state.remote, state.overrides) : []),
    [state]
  );

  if (!state) {
    return <div className="popup muted">Loading...</div>;
  }

  const { settings, remote, syncStatus } = state;
  const siteOn = hostname ? isSiteEnabled(settings, hostname) : false;
  const selected = settings.selectedLanguages;
  const activeCount = activeKeywordCount(merged);

  const toggleSite = (on: boolean): void => {
    if (!hostname) return;
    void saveSettings(setSiteEnabled(settings, hostname, on)).then(() => {
      if (activeTab) ensureContentScript(activeTab.id, activeTab.url);
    });
  };

  const setMode = (mode: 'live' | 'manual'): void => {
    void saveSettings({ ...settings, mode }).then(() => {
      if (mode === 'live' && activeTab) ensureContentScript(activeTab.id, activeTab.url);
    });
  };

  const toggleLanguage = (lang: string): void => {
    const current = selected === null ? languages : selected;
    const next = current.includes(lang)
      ? current.filter((l) => l !== lang)
      : [...current, lang];
    void saveSettings({
      ...settings,
      selectedLanguages: next.length === languages.length ? null : next
    });
  };

  const langLabel =
    selected === null
      ? 'All languages'
      : `${selected.length} of ${languages.length} languages`;

  return (
    <div className="popup">
      <h1>Amazon Forbidden Keyword Checker</h1>

      <div className="section row spread">
        <div>
          Enable on this site
          <div className="muted small">{hostname ?? 'Not a scannable page'}</div>
        </div>
        <span className="switch">
          <input
            id="afkc-site-toggle"
            type="checkbox"
            aria-label="Enable on this site"
            checked={siteOn}
            disabled={!hostname}
            onChange={(e) => toggleSite(e.target.checked)}
          />
          <span className="slider" />
        </span>
      </div>

      <div className="section">
        <div className="row spread">
          <span>Mode</span>
          <span className="segmented" role="group" aria-label="Scan mode">
            <button
              className={settings.mode === 'live' ? 'active' : ''}
              onClick={() => setMode('live')}
            >
              Live Scan
            </button>
            <button
              className={settings.mode === 'manual' ? 'active' : ''}
              onClick={() => setMode('manual')}
            >
              Manual Scan
            </button>
          </span>
        </div>
        {settings.mode === 'manual' && <ManualScan state={state} variant="popup" />}
      </div>

      <div className="section">
        <div className="row spread">
          <button className="btn btn-sm btn-primary" onClick={() => refresh()} disabled={refreshing}>
            {refreshing ? 'Syncing...' : 'Refresh keywords'}
          </button>
          <div ref={langRef} style={{ position: 'relative' }}>
            <button
              className="btn btn-sm"
              aria-haspopup="listbox"
              aria-expanded={langOpen}
              onClick={() => setLangOpen((v) => !v)}
            >
              {langLabel}
            </button>
            {langOpen && (
              <div className="lang-menu" role="listbox" style={{ right: 0, top: '26px' }}>
                <label>
                  <input
                    type="checkbox"
                    checked={selected === null}
                    onChange={() => void saveSettings({ ...settings, selectedLanguages: null })}
                  />
                  All languages
                </label>
                {languages.map((lang) => (
                  <label key={lang}>
                    <input
                      type="checkbox"
                      checked={selected === null || selected.includes(lang)}
                      onChange={() => toggleLanguage(lang)}
                    />
                    {lang}
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="muted small" style={{ marginTop: 6 }}>
          Last sync: {formatTime(remote?.syncedAt)}
          <br />
          {activeCount} active keywords / {languages.length} languages
          {remote && (
            <>
              {' / '}
              <a href={SHEET_URL} target="_blank" rel="noreferrer">
                source sheet
              </a>
            </>
          )}
        </div>
        {syncStatus.state === 'error' && !feedback && (
          <div className="error small" style={{ marginTop: 4 }}>
            Last sync failed{remote ? ' - using cached keywords' : ''}.
          </div>
        )}
        {!remote && syncStatus.state !== 'syncing' && (
          <div className="error small" style={{ marginTop: 4 }}>
            No keyword data yet. Click "Refresh keywords" to retry.
          </div>
        )}
        {feedback && (
          <div className={`${feedback.kind === 'ok' ? 'ok' : 'error'} small`} style={{ marginTop: 4 }}>
            {feedback.text}
          </div>
        )}
      </div>

      <div className="section small">
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            openOptionsPage('keywords');
          }}
        >
          Manage keywords
        </a>
        <span className="muted"> | </span>
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            openOptionsPage('sites');
          }}
        >
          Manage sites
        </a>
      </div>
    </div>
  );
}

function openOptionsPage(tab: 'keywords' | 'sites'): void {
  void chrome.tabs.create({ url: chrome.runtime.getURL(`options.html?tab=${tab}`) });
}

function ensureContentScript(tabId: number, tabUrl: string): void {
  chrome.tabs.sendMessage(tabId, { type: 'afkc.ping' }, (response) => {
    if (!chrome.runtime.lastError && response?.ok) {
      rescanContentScripts(tabId);
      window.setTimeout(() => rescanContentScripts(tabId), 350);
      return;
    }
    injectContentScript(tabId, tabUrl);
  });
}

function injectContentScript(tabId: number, tabUrl: string): void {
  if (!chrome.scripting?.executeScript) {
    chrome.tabs.sendMessage(tabId, { type: 'afkc.rescan' }, () => {
      void chrome.runtime.lastError;
    });
    return;
  }
  try {
    const url = new URL(tabUrl);
    if (url.hostname === 'docs.google.com') {
      chrome.scripting.executeScript(
        { target: { tabId }, files: ['docs-main.js'], world: 'MAIN' },
        () => {
          void chrome.runtime.lastError;
        }
      );
    }
    chrome.scripting.executeScript(
      { target: { tabId, allFrames: true }, files: ['content.js'] },
      () => {
        void chrome.runtime.lastError;
        rescanContentScripts(tabId);
        window.setTimeout(() => rescanContentScripts(tabId), 350);
      }
    );
  } catch {
    // Ignore malformed active-tab URLs.
  }
}

function rescanContentScripts(tabId: number): void {
  if (!chrome.scripting?.executeScript) {
    chrome.tabs.sendMessage(tabId, { type: 'afkc.rescan' }, () => {
      void chrome.runtime.lastError;
    });
    return;
  }
  chrome.scripting.executeScript(
    {
      target: { tabId, allFrames: true },
      func: () => {
        const rescan = (window as Window & { __afkcRequestRescan?: () => void })
          .__afkcRequestRescan;
        if (rescan) rescan();
        window.dispatchEvent(new CustomEvent('afkc.rescan'));
      }
    },
    () => {
      void chrome.runtime.lastError;
    }
  );
}
