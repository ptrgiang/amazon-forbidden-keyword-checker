import { useCallback, useEffect, useState } from 'react';
import { useExtensionState } from '../ui/useExtensionState';
import { ManageKeywords } from './ManageKeywords';
import { ManageSites } from './ManageSites';

type Tab = 'keywords' | 'sites';

function parseInitialTab(): Tab {
  const tab = new URLSearchParams(location.search).get('tab');
  return tab === 'sites' ? 'sites' : 'keywords';
}

export function OptionsApp(): JSX.Element {
  const { state } = useExtensionState();
  const [tab, setTab] = useState<Tab>(parseInitialTab);
  const switchTab = useCallback((nextTab: Tab) => {
    setTab(nextTab);
    const url = new URL(location.href);
    url.searchParams.set('tab', nextTab);
    if (nextTab !== 'keywords') url.searchParams.delete('keyword');
    if (url.href !== location.href) {
      history.pushState({ tab: nextTab }, '', url);
    }
  }, []);

  useEffect(() => {
    const onPopState = (): void => setTab(parseInitialTab());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  if (!state) return <div className="page muted">Loading…</div>;

  return (
    <div className="page">
      <h1>Amazon Forbidden Keyword Checker</h1>
      <div className="muted small">
        All scanning happens locally in your browser. Nothing is uploaded.
      </div>
      <div className="tabs" role="tablist">
        <button
          role="tab"
          aria-selected={tab === 'keywords'}
          className={tab === 'keywords' ? 'active' : ''}
          onClick={() => switchTab('keywords')}
        >
          Manage Keywords
        </button>
        <button
          role="tab"
          aria-selected={tab === 'sites'}
          className={tab === 'sites' ? 'active' : ''}
          onClick={() => switchTab('sites')}
        >
          Manage Sites
        </button>
      </div>
      {tab === 'keywords' && <ManageKeywords state={state} />}
      {tab === 'sites' && <ManageSites state={state} />}
    </div>
  );
}
