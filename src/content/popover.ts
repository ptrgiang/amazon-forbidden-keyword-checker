import type { Violation } from '../lib/types';

/** Compact popover shown when the user hovers a highlighted violation. */
export class ViolationPopover {
  private el: HTMLDivElement | null = null;
  private currentKey: string | null = null;
  private closeTimer: number | null = null;

  open(v: Violation, anchor: DOMRect): void {
    const key = this.keyFor(v, anchor);
    if (this.el && this.currentKey === key) {
      this.cancelScheduledClose();
      return;
    }
    this.cancelScheduledClose();
    this.close();
    const pop = document.createElement('div');
    pop.className = 'afkc-popover';
    this.el = pop;
    this.currentKey = key;

    const title = document.createElement('div');
    title.className = 'afkc-title';
    const term = document.createElement('span');
    term.className = 'afkc-term';
    term.textContent = v.keyword.term;
    title.appendChild(term);
    pop.appendChild(title);

    const meta = document.createElement('div');
    meta.className = 'afkc-meta';
    const langBadge = document.createElement('span');
    langBadge.className = 'afkc-badge';
    langBadge.textContent = v.keyword.languages.join(', ');
    const srcBadge = document.createElement('span');
    srcBadge.className = 'afkc-badge';
    srcBadge.textContent = v.keyword.source === 'remote' ? 'Google Sheet' : 'Local';
    srcBadge.style.marginLeft = '4px';
    meta.append('Forbidden keyword ', langBadge, srcBadge);
    pop.appendChild(meta);

    document.documentElement.appendChild(pop);
    const rect = pop.getBoundingClientRect();
    let top = anchor.bottom + 6;
    if (top + rect.height > innerHeight - 8) top = Math.max(8, anchor.top - rect.height - 6);
    let left = anchor.left;
    if (left + rect.width > innerWidth - 8) left = Math.max(8, innerWidth - rect.width - 8);
    pop.style.top = `${top}px`;
    pop.style.left = `${left}px`;

    setTimeout(() => {
      document.addEventListener('mousedown', this.outside, true);
      document.addEventListener('keydown', this.escape, true);
    }, 0);
  }

  private outside = (e: MouseEvent): void => {
    if (this.el && e.target instanceof Node && !this.el.contains(e.target)) this.close();
  };

  private escape = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') this.close();
  };

  get isOpen(): boolean {
    return this.el !== null;
  }

  contains(target: EventTarget | null): boolean {
    return target instanceof Node && this.el?.contains(target) === true;
  }

  scheduleClose(delay = 120): void {
    if (!this.el) return;
    this.cancelScheduledClose();
    this.closeTimer = setTimeout(() => {
      this.closeTimer = null;
      this.close();
    }, delay) as unknown as number;
  }

  cancelScheduledClose(): void {
    if (this.closeTimer !== null) clearTimeout(this.closeTimer);
    this.closeTimer = null;
  }

  close(): void {
    this.cancelScheduledClose();
    document.removeEventListener('mousedown', this.outside, true);
    document.removeEventListener('keydown', this.escape, true);
    this.el?.remove();
    this.el = null;
    this.currentKey = null;
  }

  private keyFor(v: Violation, anchor: DOMRect): string {
    return [
      v.keyword.id,
      Math.round(anchor.left),
      Math.round(anchor.top),
      Math.round(anchor.width),
      Math.round(anchor.height)
    ].join(':');
  }
}
