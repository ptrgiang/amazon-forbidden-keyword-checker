import { Fragment, useMemo, useRef, useState } from 'react';
import { KeywordMatcher } from '../lib/matcher';
import { allLanguages, mergeKeywords } from '../lib/merge';
import type { StoredState } from '../lib/storage';
import type { Violation } from '../lib/types';

function renderInlineHighlights(text: string, violations: Violation[]): JSX.Element[] {
  const parts: JSX.Element[] = [];
  const sorted = [...violations].sort((a, b) => a.start - b.start);
  let pos = 0;
  sorted.forEach((v, i) => {
    if (v.start > pos) {
      parts.push(<Fragment key={`t${i}`}>{text.slice(pos, v.start)}</Fragment>);
    }
    const tooltip = [
      v.keyword.languages.join(', '),
      v.keyword.source === 'remote' ? 'Google Sheet' : 'Local'
    ].filter(Boolean).join(' - ');
    parts.push(
      <mark key={`m${i}`} title={tooltip}>
        {text.slice(v.start, v.end)}
      </mark>
    );
    pos = v.end;
  });
  parts.push(<Fragment key="tail">{text.slice(pos)}</Fragment>);
  return parts;
}

export function ManualScan({
  state,
  variant = 'page'
}: {
  state: StoredState;
  variant?: 'page' | 'popup';
}): JSX.Element {
  const [text, setText] = useState('');
  const [langFilter, setLangFilter] = useState<string>('__all__');
  const [result, setResult] = useState<{ text: string; violations: Violation[] } | null>(null);
  const [copied, setCopied] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);
  const isPopup = variant === 'popup';

  const languages = useMemo(
    () => allLanguages(state.remote, state.overrides),
    [state]
  );
  const merged = useMemo(
    () => mergeKeywords(state.remote, state.overrides),
    [state]
  );

  const runScan = (input: string): void => {
    const selection = langFilter === '__all__' ? state.settings.selectedLanguages : [langFilter];
    const matcher = new KeywordMatcher(merged, selection);
    setResult({ text: input, violations: matcher.scan(input) });
    setCopied(false);
    requestAnimationFrame(syncHighlightMetrics);
  };

  const copyText = (): void => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const clearAll = (): void => {
    setText('');
    setResult(null);
    setCopied(false);
  };

  const hasInlineHighlight = result?.text === text && result.violations.length > 0;
  const highlighted = useMemo(
    () =>
      hasInlineHighlight
        ? renderInlineHighlights(text, result?.violations ?? [])
        : [<Fragment key="plain">{text}</Fragment>],
    [hasInlineHighlight, result?.violations, text]
  );

  const syncHighlightScroll = (): void => {
    if (!textareaRef.current || !highlightRef.current) return;
    highlightRef.current.scrollTop = textareaRef.current.scrollTop;
    highlightRef.current.scrollLeft = textareaRef.current.scrollLeft;
  };

  const syncHighlightMetrics = (): void => {
    if (!textareaRef.current || !highlightRef.current) return;
    highlightRef.current.style.height = `${textareaRef.current.offsetHeight}px`;
    syncHighlightScroll();
  };

  const handleInputChange = (value: string): void => {
    setText(value);
    setResult(null);
    setCopied(false);
  };

  return (
    <div className={isPopup ? 'manual-scan manual-scan-popup' : 'manual-scan'}>
      <div className={isPopup ? '' : 'card'}>
        {!isPopup && (
          <div className="row manual-scan-lang">
            <label htmlFor="ms-lang">Languages:</label>
            <select
              id="ms-lang"
              className="select"
              value={langFilter}
              onChange={(e) => setLangFilter(e.target.value)}
            >
              <option value="__all__">
                {state.settings.selectedLanguages === null
                  ? 'All languages'
                  : `Current selection (${state.settings.selectedLanguages.length})`}
              </option>
              {languages.map((language) => (
                <option key={language} value={language}>
                  {language}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className={`manual-scan-editor${hasInlineHighlight ? ' has-highlight' : ''}`}>
          <div
            ref={highlightRef}
            className="manual-scan-highlight-layer"
            aria-hidden="true"
            onMouseDown={(e) => {
              e.preventDefault();
              textareaRef.current?.focus();
            }}
            onWheel={(e) => {
              if (!textareaRef.current || !highlightRef.current) return;
              textareaRef.current.scrollTop += e.deltaY;
              textareaRef.current.scrollLeft += e.deltaX;
              syncHighlightScroll();
            }}
          >
            {highlighted}
          </div>
          <textarea
            ref={textareaRef}
            className="textarea manual-scan-textarea"
            style={{ minHeight: isPopup ? 92 : 160 }}
            placeholder="Paste or type the text you want to check..."
            spellCheck={false}
            value={text}
            onChange={(e) => handleInputChange(e.target.value)}
            onScroll={syncHighlightScroll}
            onInput={syncHighlightMetrics}
            onFocus={syncHighlightMetrics}
            onMouseUp={syncHighlightMetrics}
          />
        </div>
        <div className="row manual-scan-actions">
          <button className="btn btn-primary" onClick={() => runScan(text)} disabled={!text}>
            Scan Text
          </button>
          <button className="btn" onClick={copyText} disabled={!text}>
            {copied ? 'Copied' : 'Copy'}
          </button>
          <button className="btn" onClick={clearAll} disabled={!text && !result}>
            Clear
          </button>
        </div>
        {result && (
          <div className={`small ${result.violations.length > 0 ? 'error' : 'ok'}`} style={{ marginTop: 6 }}>
            {result.violations.length === 0
              ? 'No violations found'
              : `${result.violations.length} violation${result.violations.length === 1 ? '' : 's'}`}
          </div>
        )}
      </div>
    </div>
  );
}
