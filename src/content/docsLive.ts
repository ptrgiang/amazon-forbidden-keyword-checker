import type { KeywordMatcher } from '../lib/matcher';
import type { Violation } from '../lib/types';
import { injectStyles } from './styles';

/**
 * Live scanning for Google Docs.
 *
 * Google editors paint content on <canvas>, but when the extension-annotation
 * mode is enabled (see public/docs-main.js) every rendered text line is
 * mirrored as an SVG <rect aria-label="line text" data-font-css="...">.
 * This scanner reads those rects, runs the keyword matcher per line, and
 * measures the substring position with canvas text metrics to draw
 * overlay highlight boxes. Nothing in the document is ever modified.
 */

interface DocsBox {
  rect: DOMRect;
  violation: Violation;
}

const LINE_SELECTOR = '.kix-canvas-tile-content svg rect[aria-label]';

export class DocsCanvasScanner {
  private overlay: HTMLDivElement | null = null;
  private boxes: DocsBox[] = [];
  private observer: MutationObserver | null = null;
  private timer: number | null = null;
  private running = false;
  private measure = document.createElement('canvas').getContext('2d');
  private popover: HTMLDivElement | null = null;
  private popoverKey: string | null = null;
  private closeTimer: number | null = null;

  constructor(private getMatcher: () => KeywordMatcher) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    injectStyles();
    this.observer = new MutationObserver(() => this.schedule(400));
    this.observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['aria-label']
    });
    document.addEventListener('scroll', this.onViewChange, true);
    window.addEventListener('resize', this.onViewChange);
    document.addEventListener('mousemove', this.onMouseMove, true);
    document.addEventListener('keydown', this.onKeyDown, true);
    this.schedule(600);
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.observer?.disconnect();
    this.observer = null;
    document.removeEventListener('scroll', this.onViewChange, true);
    window.removeEventListener('resize', this.onViewChange);
    document.removeEventListener('mousemove', this.onMouseMove, true);
    document.removeEventListener('keydown', this.onKeyDown, true);
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.boxes = [];
    this.overlay?.remove();
    this.overlay = null;
    this.closePopover();
  }

  rescan(): void {
    if (!this.running) return;
    this.schedule(0);
  }

  private onViewChange = (): void => this.schedule(150);

  private schedule(ms: number): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.scan();
    }, ms) as unknown as number;
  }

  private scan(): void {
    if (!this.running || !this.measure) return;
    const matcher = this.getMatcher();
    const boxes: DocsBox[] = [];
    const rects = document.querySelectorAll<SVGRectElement>(LINE_SELECTOR);
    for (const lineEl of rects) {
      const text = lineEl.getAttribute('aria-label') ?? '';
      if (!text || !text.trim()) continue;
      const violations = matcher.scan(text);
      if (violations.length === 0) continue;
      const line = lineEl.getBoundingClientRect();
      if (line.width <= 0 || line.bottom < 0 || line.top > innerHeight) continue;
      const font = lineEl.getAttribute('data-font-css');
      if (font) this.measure.font = font;
      const fullWidth = this.measure.measureText(text).width;
      const scale = fullWidth > 0 ? line.width / fullWidth : 1;
      for (const v of violations) {
        const pre = this.measure.measureText(text.slice(0, v.start)).width * scale;
        const width = this.measure.measureText(text.slice(v.start, v.end)).width * scale;
        if (width <= 0) continue;
        boxes.push({
          rect: new DOMRect(line.left + pre, line.top, width, line.height),
          violation: v
        });
      }
    }
    this.boxes = boxes;
    this.render();
  }

  private getOverlay(): HTMLDivElement {
    if (!this.overlay || !this.overlay.isConnected) {
      this.overlay = document.createElement('div');
      this.overlay.id = 'afkc-docs-overlay';
      this.overlay.style.cssText =
        'position:fixed;inset:0;pointer-events:none;z-index:2147483645;';
      document.documentElement.appendChild(this.overlay);
    }
    return this.overlay;
  }

  private render(): void {
    const overlay = this.getOverlay();
    overlay.textContent = '';
    for (const b of this.boxes) {
      const el = document.createElement('div');
      el.className = 'afkc-hl';
      el.style.left = `${b.rect.left}px`;
      el.style.top = `${b.rect.top}px`;
      el.style.width = `${b.rect.width}px`;
      el.style.height = `${b.rect.height}px`;
      overlay.appendChild(el);
    }
  }

  private onMouseMove = (e: MouseEvent): void => {
    if (e.target instanceof Node && this.popover?.contains(e.target)) {
      this.cancelScheduledClose();
      return;
    }
    for (const b of this.boxes) {
      const r = b.rect;
      if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
        this.openPopover(b);
        return;
      }
    }
    this.scheduleClose();
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') this.closePopover();
  };

  private openPopover(b: DocsBox): void {
    const key = this.keyForBox(b);
    if (this.popover && this.popoverKey === key) {
      this.cancelScheduledClose();
      return;
    }
    this.cancelScheduledClose();
    this.closePopover();
    const v = b.violation;
    const pop = document.createElement('div');
    pop.className = 'afkc-popover';
    this.popover = pop;
    this.popoverKey = key;

    const title = document.createElement('div');
    title.className = 'afkc-title';
    const term = document.createElement('span');
    term.className = 'afkc-term';
    term.textContent = v.keyword.term;
    title.appendChild(term);
    pop.appendChild(title);

    const meta = document.createElement('div');
    meta.className = 'afkc-meta';
    const lang = document.createElement('span');
    lang.className = 'afkc-badge';
    lang.textContent = v.keyword.languages.join(', ');
    const src = document.createElement('span');
    src.className = 'afkc-badge';
    src.style.marginLeft = '4px';
    src.textContent = v.keyword.source === 'remote' ? 'Google Sheet' : 'Local';
    meta.append('Forbidden keyword ', lang, src);
    pop.appendChild(meta);

    document.documentElement.appendChild(pop);
    const rect = pop.getBoundingClientRect();
    let top = b.rect.bottom + 6;
    if (top + rect.height > innerHeight - 8) top = Math.max(8, b.rect.top - rect.height - 6);
    let left = b.rect.left;
    if (left + rect.width > innerWidth - 8) left = Math.max(8, innerWidth - rect.width - 8);
    pop.style.top = `${top}px`;
    pop.style.left = `${left}px`;
  }

  private closePopover(): void {
    this.cancelScheduledClose();
    this.popover?.remove();
    this.popover = null;
    this.popoverKey = null;
  }

  private scheduleClose(): void {
    if (!this.popover) return;
    this.cancelScheduledClose();
    this.closeTimer = setTimeout(() => {
      this.closeTimer = null;
      this.closePopover();
    }, 120) as unknown as number;
  }

  private cancelScheduledClose(): void {
    if (this.closeTimer !== null) clearTimeout(this.closeTimer);
    this.closeTimer = null;
  }

  private keyForBox(b: DocsBox): string {
    return [
      b.violation.keyword.id,
      Math.round(b.rect.left),
      Math.round(b.rect.top),
      Math.round(b.rect.width),
      Math.round(b.rect.height)
    ].join(':');
  }
}
