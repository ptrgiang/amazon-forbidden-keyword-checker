import type { Violation } from '../lib/types';

export interface PanelOptions {
  title: string;
  violations: Violation[];
  onClose?: () => void;
  highlightToggle?: {
    checked: boolean;
    onToggle: (checked: boolean) => void;
  };
}

interface ViolationSummary {
  violation: Violation;
  count: number;
  firstSeen: number;
}

function dedupeViolations(violations: Violation[]): ViolationSummary[] {
  const summaries = new Map<string, ViolationSummary>();
  for (const [index, violation] of violations.entries()) {
    const key = violation.keyword.key;
    const summary = summaries.get(key);
    if (summary) {
      summary.count += 1;
    } else {
      summaries.set(key, { violation, count: 1, firstSeen: index });
    }
  }
  return [...summaries.values()].sort((a, b) => b.count - a.count || a.firstSeen - b.firstSeen);
}

/**
 * Floating result panel used for context-menu scans and for editors where
 * inline highlighting is not technically reliable (Google Docs canvas).
 */
export class ViolationPanel {
  private el: HTMLDivElement | null = null;
  private onClose: (() => void) | null = null;

  open(opts: PanelOptions): void {
    this.close();
    const panel = document.createElement('div');
    panel.className = 'afkc-panel';
    panel.style.right = '16px';
    panel.style.bottom = '16px';
    this.el = panel;
    this.onClose = opts.onClose ?? null;

    const head = document.createElement('div');
    head.className = 'afkc-panel-head';
    const title = document.createElement('span');
    title.className = 'afkc-panel-title';
    title.textContent = opts.title;
    const actions = document.createElement('div');
    actions.className = 'afkc-panel-actions';
    if (opts.highlightToggle) {
      const highlightBtn = document.createElement('button');
      highlightBtn.className = 'afkc-highlight-switch';
      const setHighlightChecked = (checked: boolean): void => {
        highlightBtn.classList.toggle('active', checked);
        highlightBtn.setAttribute('aria-pressed', String(checked));
        highlightBtn.title = checked ? 'Disable website highlight' : 'Enable website highlight';
      };
      highlightBtn.type = 'button';
      highlightBtn.textContent = 'Highlight';
      highlightBtn.addEventListener('click', () => {
        const checked = highlightBtn.getAttribute('aria-pressed') !== 'true';
        setHighlightChecked(checked);
        opts.highlightToggle?.onToggle(checked);
      });
      setHighlightChecked(opts.highlightToggle.checked);
      actions.appendChild(highlightBtn);
    }
    const minimizeBtn = document.createElement('button');
    minimizeBtn.className = 'afkc-close afkc-icon-btn';
    const setMinimized = (minimized: boolean): void => {
      panel.classList.toggle('afkc-panel-minimized', minimized);
      minimizeBtn.setAttribute('aria-label', minimized ? 'Restore' : 'Minimize');
      minimizeBtn.title = minimized ? 'Restore' : 'Minimize';
      minimizeBtn.textContent = minimized ? '▲' : '▼';
    };
    minimizeBtn.addEventListener('click', () => {
      setMinimized(!panel.classList.contains('afkc-panel-minimized'));
    });
    setMinimized(false);
    const closeBtn = document.createElement('button');
    closeBtn.className = 'afkc-close afkc-icon-btn';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.textContent = 'X';
    closeBtn.addEventListener('click', () => {
      this.close();
    });
    actions.append(minimizeBtn, closeBtn);
    head.append(title, actions);
    panel.appendChild(head);

    const body = document.createElement('div');
    body.className = 'afkc-panel-body';
    panel.appendChild(body);

    const count = document.createElement('div');
    count.style.marginBottom = '6px';
    const summaries = dedupeViolations(opts.violations);
    count.textContent =
      opts.violations.length === 0
        ? 'No forbidden keywords found.'
        : `${opts.violations.length} violation${opts.violations.length === 1 ? '' : 's'} found` +
          (summaries.length === opts.violations.length ? ':' : ` (${summaries.length} unique):`);
    body.appendChild(count);

    for (const { violation: v, count: duplicateCount } of summaries) {
      const item = document.createElement('div');
      item.className = 'afkc-panel-item';
      const main = document.createElement('div');
      main.className = 'afkc-panel-item-main';
      const info = document.createElement('div');
      info.className = 'afkc-panel-item-info';
      const term = document.createElement('span');
      term.className = 'afkc-term';
      term.textContent = v.found;
      const lang = document.createElement('span');
      lang.className = 'afkc-badge';
      lang.style.marginLeft = '6px';
      lang.textContent = v.keyword.languages.join(', ');
      const src = document.createElement('span');
      src.className = 'afkc-badge';
      src.style.marginLeft = '4px';
      src.textContent = v.keyword.source === 'remote' ? 'Google Sheet' : 'Local';
      const occurrences = document.createElement('span');
      occurrences.className = 'afkc-count-badge';
      occurrences.textContent = String(duplicateCount);
      info.append(term, lang, src);
      main.append(info, occurrences);
      item.appendChild(main);
      body.appendChild(item);
    }

    document.documentElement.appendChild(panel);
  }

  close(): void {
    const onClose = this.onClose;
    this.onClose = null;
    this.el?.remove();
    this.el = null;
    onClose?.();
  }
}
