import type { KeywordMatcher } from '../lib/matcher';
import type { Violation } from '../lib/types';
import { ViolationPopover } from './popover';
import { injectStyles } from './styles';

interface SheetBox {
  rect: DOMRect;
  violation: Violation;
  painted?: boolean;
}

interface CanvasTextBox {
  text: string;
  left: number;
  top: number;
  width: number;
  height: number;
  pageKey?: string;
  painted?: boolean;
}

const VIEW_SETTLE_REFRESH_MS = 700;
const VIEW_REFRESH_PULSES_MS = [40, 160, 360, 700, 1200];
const CANVAS_REPAINT_PULSES_MS = [120, 700, 1500];

const GRID_SELECTOR = [
  '#waffle-grid-container',
  '.waffle-grid-container',
  '.grid-container',
  '[role="grid"]'
].join(', ');

const CELL_SELECTOR = [
  'svg rect[aria-label]',
  '[role="gridcell"]',
  '[aria-label]'
].join(', ');

const SHEET_EDITOR_SELECTOR = [
  '.cell-input',
  '#t-formula-bar-input',
  '[contenteditable="true"][role="textbox"]',
  '[contenteditable="true"]',
  '[role="textbox"]'
].join(', ');

function candidateText(el: Element): string {
  return (el.getAttribute('aria-label') ?? el.textContent ?? '').trim();
}

function isVisibleRect(rect: DOMRect): boolean {
  return rect.width > 2 && rect.height > 2 && rect.bottom >= 0 && rect.top <= innerHeight;
}

function isGridCandidate(el: Element): boolean {
  const grid = el.closest(GRID_SELECTOR);
  if (grid) return true;
  return el instanceof SVGRectElement && el.hasAttribute('data-font-css');
}

/**
 * Google Sheets paints grid cells on canvas, but in annotated/accessibility
 * modes it exposes visible cell boxes with aria-label text. This scanner reads
 * those boxes and canvas paint events, then highlights the detected word area.
 */
export class SheetsGridScanner {
  private overlay: HTMLDivElement | null = null;
  private boxes: SheetBox[] = [];
  private observer: MutationObserver | null = null;
  private timer: number | null = null;
  private settleTimer: number | null = null;
  private refreshTimers: number[] = [];
  private running = false;
  private popover = new ViolationPopover();
  private canvasItems: CanvasTextBox[] = [];
  private lastViewChangeAt = 0;
  private lastPointer: { x: number; y: number; seenAt: number } | null = null;
  private lastCanvasRefreshAt = 0;
  private ignoreCanvasItemsBefore = 0;
  private urlTimer: number | null = null;
  private lastSheetViewKey = currentSheetsPageKey();
  private didRunInitialWake = false;

  constructor(private getMatcher: () => KeywordMatcher) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.didRunInitialWake = false;
    injectStyles();
    document.getElementById('afkc-sheets-overlay')?.remove();
    this.syncCanvasPaintPatterns();
    window.setTimeout(() => {
      if (this.running) this.syncCanvasPaintPatterns();
    }, 250);
    window.setTimeout(() => {
      if (this.running) this.syncCanvasPaintPatterns();
    }, 1000);
    this.observer = new MutationObserver(() => this.schedule(250));
    this.observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['aria-label', 'style', 'class']
    });
    document.addEventListener('scroll', this.onViewChange, true);
    window.addEventListener('resize', this.onViewChange);
    document.addEventListener('mousemove', this.onMouseMove, true);
    document.addEventListener('keyup', this.onInputLike, true);
    document.addEventListener('input', this.onInputLike, true);
    document.addEventListener('visibilitychange', this.onPageWake, true);
    window.addEventListener('focus', this.onPageWake);
    window.addEventListener('pageshow', this.onPageWake);
    window.addEventListener('message', this.onMessage);
    this.urlTimer = window.setInterval(this.checkUrlChange, 400);
    this.schedule(0);
    window.setTimeout(() => this.schedule(0), 750);
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.observer?.disconnect();
    this.observer = null;
    document.removeEventListener('scroll', this.onViewChange, true);
    window.removeEventListener('resize', this.onViewChange);
    document.removeEventListener('mousemove', this.onMouseMove, true);
    document.removeEventListener('keyup', this.onInputLike, true);
    document.removeEventListener('input', this.onInputLike, true);
    document.removeEventListener('visibilitychange', this.onPageWake, true);
    window.removeEventListener('focus', this.onPageWake);
    window.removeEventListener('pageshow', this.onPageWake);
    window.removeEventListener('message', this.onMessage);
    if (this.timer !== null) clearTimeout(this.timer);
    if (this.settleTimer !== null) clearTimeout(this.settleTimer);
    if (this.urlTimer !== null) clearInterval(this.urlTimer);
    for (const refreshTimer of this.refreshTimers) clearTimeout(refreshTimer);
    this.timer = null;
    this.settleTimer = null;
    this.urlTimer = null;
    this.refreshTimers = [];
    this.boxes = [];
    this.canvasItems = [];
    document.getElementById('afkc-sheets-overlay')?.remove();
    this.overlay = null;
    this.didRunInitialWake = false;
    this.popover.close();
    this.disableCanvasPaint();
  }

  rescan(): void {
    if (!this.running) return;
    this.syncCanvasPaintPatterns();
    this.schedule(0);
  }

  private onViewChange = (): void => {
    this.resetViewState();
    this.schedule(40);
    this.scheduleViewRefreshPulses();
    this.scheduleSettledRefresh(this.lastViewChangeAt);
  };

  private checkUrlChange = (): void => {
    const nextSheetViewKey = currentSheetsPageKey();
    if (nextSheetViewKey === this.lastSheetViewKey) return;
    this.lastSheetViewKey = nextSheetViewKey;
    this.resetViewState();
    this.schedule(80);
  };

  private onPageWake = (): void => {
    if (document.visibilityState === 'hidden') return;
    this.lastViewChangeAt = Date.now();
    this.ignoreCanvasItemsBefore = this.lastViewChangeAt;
    this.boxes = [];
    this.canvasItems = [];
    this.renderOverlay();
    this.popover.close();
    this.clearCanvasQueue();
    this.syncCanvasPaintPatterns();
    this.schedule(60);
    this.scheduleSettledRefresh(this.lastViewChangeAt);
  };

  private resetViewState(): void {
    this.lastViewChangeAt = Date.now();
    this.ignoreCanvasItemsBefore = this.lastViewChangeAt;
    this.boxes = [];
    this.canvasItems = [];
    this.renderOverlay();
    this.popover.close();
    this.clearCanvasQueue();
    this.requestCanvasRefresh();
  }
  private onInputLike = (): void => {
    this.syncCanvasPaintPatterns();
    this.schedule(80);
  };

  private onMessage = (event: MessageEvent): void => {
    if (event.source !== window) return;
    const data = event.data as { source?: unknown; items?: unknown; sentAt?: unknown };
    if (data?.source === 'afkc-sheets-ready') {
      this.syncCanvasPaintPatterns();
      this.runInitialCanvasWake();
      return;
    }
    if (data?.source !== 'afkc-sheets-canvas' || !Array.isArray(data.items)) return;
    const sentAt = typeof data.sentAt === 'number' ? data.sentAt : Date.now();
    if (sentAt < this.ignoreCanvasItemsBefore) return;
    this.mergeCanvasItems(data.items.filter(isCanvasTextBox));
    this.scan();
    this.openAtLastPointer();
  };

  private mergeCanvasItems(items: CanvasTextBox[]): void {
    const matcher = this.getMatcher();
    const pageKey = currentSheetsPageKey();
    const nextItems: CanvasTextBox[] = [];
    for (const item of items) {
      if (item.pageKey && item.pageKey !== pageKey) continue;
      if (matcher.scan(item.text).length === 0) continue;
      nextItems.push(item);
    }
    this.canvasItems = nextItems;
  }

  private scheduleSettledRefresh(viewChangeAt: number): void {
    if (this.settleTimer !== null) clearTimeout(this.settleTimer);
    this.settleTimer = setTimeout(() => {
      this.settleTimer = null;
      if (!this.running || this.lastViewChangeAt !== viewChangeAt) return;
      this.schedule(0);
    }, VIEW_SETTLE_REFRESH_MS) as unknown as number;
  }

  private scheduleViewRefreshPulses(): void {
    for (const refreshTimer of this.refreshTimers) clearTimeout(refreshTimer);
    const timers: number[] = [];
    for (const delay of VIEW_REFRESH_PULSES_MS) {
      const refreshTimer = setTimeout(() => {
        this.refreshTimers = this.refreshTimers.filter((timer) => timer !== refreshTimer);
        this.schedule(0);
      }, delay) as unknown as number;
      timers.push(refreshTimer);
    }
    this.refreshTimers = timers;
  }

  private schedule(ms: number): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.scan();
    }, ms) as unknown as number;
  }

  private scan(): void {
    if (!this.running) return;
    const matcher = this.getMatcher();
    const boxes: SheetBox[] = [];
    const seen = new Set<string>();

    for (const item of this.canvasItems) {
      const text = item.text;
      if (!text.trim() || text.length > 500) continue;
      const violations = matcher.scan(text);
      if (violations.length === 0) continue;
      const rect = new DOMRect(item.left, item.top, item.width, item.height);
      if (!isVisibleRect(rect)) continue;
      for (const violation of violations) {
        const hitRect = rectForViolation(rect, text, violation);
        const key = `${Math.round(hitRect.left)}:${Math.round(hitRect.top)}:${Math.round(hitRect.width)}:${Math.round(hitRect.height)}:${violation.keyword.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        boxes.push({ rect: hitRect, violation, painted: item.painted === true });
      }
    }

    for (const el of document.querySelectorAll(CELL_SELECTOR)) {
      if (!isGridCandidate(el)) continue;
      const text = candidateText(el);
      if (!text || text.length > 500) continue;
      const violations = matcher.scan(text);
      if (violations.length === 0) continue;
      const rect = el.getBoundingClientRect();
      if (!isVisibleRect(rect)) continue;
      for (const violation of violations) {
        const hitRect = rectForViolation(rect, text, violation);
        const key = `${Math.round(hitRect.left)}:${Math.round(hitRect.top)}:${Math.round(hitRect.width)}:${Math.round(hitRect.height)}:${violation.keyword.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        boxes.push({
          rect: hitRect,
          violation,
          painted: false
        });
      }
    }

    this.boxes = boxes;
    this.renderOverlay();
  }

  private getOverlay(): HTMLDivElement {
    if (!this.overlay || !this.overlay.isConnected) {
      this.overlay = document.createElement('div');
      this.overlay.id = 'afkc-sheets-overlay';
      this.overlay.style.cssText =
        'position:fixed;inset:0;pointer-events:none;z-index:2147483645;';
      document.documentElement.appendChild(this.overlay);
    }
    return this.overlay;
  }

  private renderOverlay(): void {
    if (!this.running) return;
    const overlay = this.getOverlay();
    const editorRects = activeSheetEditorRects();
    overlay.textContent = '';
    for (const box of this.boxes) {
      if (box.painted === true) continue;
      if (!isVisibleRect(box.rect)) continue;
      if (overlapsAnyRect(box.rect, editorRects, 3)) continue;
      const el = document.createElement('div');
      el.className = 'afkc-hl afkc-sheets-hl';
      el.style.left = `${box.rect.left}px`;
      el.style.top = `${box.rect.top}px`;
      el.style.width = `${box.rect.width}px`;
      el.style.height = `${box.rect.height}px`;
      overlay.appendChild(el);
    }
  }

  private onMouseMove = (e: MouseEvent): void => {
    this.lastPointer = { x: e.clientX, y: e.clientY, seenAt: Date.now() };
    if (this.popover.contains(e.target)) {
      this.popover.cancelScheduledClose();
      return;
    }
    let hit = this.hitTest(e.clientX, e.clientY);
    if (!hit) {
      this.requestCanvasRefresh();
      this.scan();
      hit = this.hitTest(e.clientX, e.clientY);
    }
    if (hit) {
      this.popover.open(hit.violation, hit.rect);
      return;
    }
    this.popover.scheduleClose();
  };

  private openAtLastPointer(): void {
    if (!this.lastPointer || Date.now() - this.lastPointer.seenAt > 1200) return;
    const hit = this.hitTest(this.lastPointer.x, this.lastPointer.y);
    if (hit) this.popover.open(hit.violation, hit.rect);
  }

  private hitTest(x: number, y: number): SheetBox | null {
    const editorRects = activeSheetEditorRects();
    for (const b of this.boxes) {
      if (overlapsAnyRect(b.rect, editorRects, 3)) continue;
      if (pointInRect(x, y, b.rect, 6)) return b;
    }
    const matcher = this.getMatcher();
    for (const item of this.canvasItems) {
      const text = item.text;
      if (!text.trim() || text.length > 500) continue;
      const rect = new DOMRect(item.left, item.top, item.width, item.height);
      if (!pointInRect(x, y, rect, 4)) continue;
      for (const violation of matcher.scan(text)) {
        const hitRect = rectForViolation(rect, text, violation);
        if (overlapsAnyRect(hitRect, editorRects, 3)) continue;
        if (pointInRect(x, y, hitRect, 8)) {
          return { rect: hitRect, violation, painted: item.painted === true };
        }
      }
    }
    return null;
  }

  private syncCanvasPaintPatterns(): void {
    this.lastCanvasRefreshAt = Date.now();
    window.postMessage(
      {
        source: 'afkc-sheets-config',
        patterns: this.getMatcher().patterns()
      },
      '*'
    );
    this.runInitialCanvasWake();
  }

  private requestCanvasRefresh(): void {
    const now = Date.now();
    if (now - this.lastCanvasRefreshAt < 250) return;
    this.syncCanvasPaintPatterns();
  }

  private disableCanvasPaint(): void {
    window.postMessage({ source: 'afkc-sheets-config', patterns: [] }, '*');
    this.clearCanvasQueue();
  }

  private clearCanvasQueue(): void {
    window.postMessage({ source: 'afkc-sheets-clear' }, '*');
  }

  private runInitialCanvasWake(): void {
    if (this.didRunInitialWake) return;
    this.didRunInitialWake = true;
    for (const delay of CANVAS_REPAINT_PULSES_MS) {
      window.setTimeout(() => {
        window.postMessage({ source: 'afkc-sheets-wake' }, '*');
        window.dispatchEvent(new Event('resize'));
        forceSheetsGridRefresh();
      }, delay);
    }
  }
}

function forceSheetsGridRefresh(): void {
  let nudged = false;
  const grid = document.querySelector(GRID_SELECTOR);
  const candidates = grid ? gridScrollCandidates(grid) : [];

  for (const el of candidates) {
    if (!isVisibleRect(el.getBoundingClientRect())) continue;
    nudged = nudgeScrollPosition(el) || nudged;
  }

  if (grid) {
    grid.dispatchEvent(new Event('scroll', { bubbles: true }));
  }
  if (!nudged) document.dispatchEvent(new Event('scroll', { bubbles: true }));
}

function gridScrollCandidates(grid: Element): HTMLElement[] {
  const candidates = new Set<HTMLElement>();
  if (grid instanceof HTMLElement && isScrollableElement(grid)) candidates.add(grid);

  for (const el of grid.querySelectorAll('*')) {
    if (el instanceof HTMLElement && isScrollableElement(el)) candidates.add(el);
  }

  let parent = grid.parentElement;
  while (parent && parent !== document.body && parent !== document.documentElement) {
    if (isScrollableElement(parent)) candidates.add(parent);
    parent = parent.parentElement;
  }

  return [...candidates].slice(0, 8);
}

function isScrollableElement(el: Element): el is HTMLElement {
  if (!(el instanceof HTMLElement)) return false;
  return el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1;
}

function nudgeScrollPosition(el: HTMLElement): boolean {
  const startTop = el.scrollTop;
  const startLeft = el.scrollLeft;
  let changed = false;

  if (el.scrollWidth > el.clientWidth + 1) {
    const maxLeft = el.scrollWidth - el.clientWidth;
    const nextLeft = startLeft < maxLeft ? startLeft + 1 : Math.max(0, startLeft - 1);
    el.scrollLeft = nextLeft;
    changed = changed || el.scrollLeft !== startLeft;
  }

  if (el.scrollHeight > el.clientHeight + 1) {
    const maxTop = el.scrollHeight - el.clientHeight;
    const nextTop = startTop < maxTop ? startTop + 1 : Math.max(0, startTop - 1);
    el.scrollTop = nextTop;
    changed = changed || el.scrollTop !== startTop;
  }

  if (!changed) return false;
  el.dispatchEvent(new Event('scroll', { bubbles: true }));
  window.requestAnimationFrame(() => {
    el.scrollLeft = startLeft;
    el.scrollTop = startTop;
    el.dispatchEvent(new Event('scroll', { bubbles: true }));
  });
  return true;
}

function pointInRect(x: number, y: number, rect: DOMRect, pad = 0): boolean {
  return (
    x >= rect.left - pad &&
    x <= rect.right + pad &&
    y >= rect.top - pad &&
    y <= rect.bottom + pad
  );
}

function activeSheetEditorRects(): DOMRect[] {
  const active = document.activeElement;
  const candidates = new Set<Element>();

  if (active instanceof Element) {
    const editor = active.closest(SHEET_EDITOR_SELECTOR);
    if (editor) candidates.add(editor);
  }

  for (const el of document.querySelectorAll(SHEET_EDITOR_SELECTOR)) {
    if (!(el instanceof HTMLElement)) continue;
    if (active instanceof Element && (el === active || el.contains(active))) {
      candidates.add(el);
      continue;
    }
    if (el.classList.contains('cell-input') && elementLooksVisible(el)) {
      candidates.add(el);
    }
  }

  return [...candidates]
    .map((el) => el.getBoundingClientRect())
    .filter((rect) => isVisibleRect(rect));
}

function elementLooksVisible(el: HTMLElement): boolean {
  const style = getComputedStyle(el);
  return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
}

function overlapsAnyRect(rect: DOMRect, others: DOMRect[], pad = 0): boolean {
  return others.some((other) => rectsOverlap(rect, other, pad));
}

function rectsOverlap(a: DOMRect, b: DOMRect, pad = 0): boolean {
  return (
    a.left - pad < b.right &&
    a.right + pad > b.left &&
    a.top - pad < b.bottom &&
    a.bottom + pad > b.top
  );
}

function rectForViolation(rect: DOMRect, text: string, violation: Violation): DOMRect {
  const visualRange = trimVisualRange(text, violation.start, violation.end);
  if (!visualRange) return new DOMRect(rect.left, rect.top, 0, 0);
  const totalWidth = approximateTextWidth(text);
  if (totalWidth <= 0) return new DOMRect(rect.left, rect.top, rect.width, rect.height);
  const before = approximateTextWidth(text.slice(0, visualRange.start));
  const match = approximateTextWidth(text.slice(visualRange.start, visualRange.end));
  const inset = 1;
  const left = rect.left + (before / totalWidth) * rect.width + inset;
  const width = Math.max(2, (match / totalWidth) * rect.width - inset * 2);
  const height = Math.min(rect.height, 22);
  const top = rect.top + Math.max(0, (rect.height - height) / 2);
  return new DOMRect(left, top, width, height);
}

function trimVisualRange(text: string, start: number, end: number): { start: number; end: number } | null {
  let visualStart = start;
  let visualEnd = end;
  while (visualStart < visualEnd && /\s/.test(text[visualStart] ?? '')) visualStart += 1;
  while (visualEnd > visualStart && /\s/.test(text[visualEnd - 1] ?? '')) visualEnd -= 1;
  return visualStart < visualEnd ? { start: visualStart, end: visualEnd } : null;
}

function approximateTextWidth(text: string): number {
  let width = 0;
  for (const char of text) {
    if (/\s/.test(char)) width += 0.45;
    else if (/[ilI|.,'`!]/.test(char)) width += 0.45;
    else if (/[mwMW@#%&]/.test(char)) width += 1.35;
    else if (char.charCodeAt(0) > 0x2ff) width += 1.8;
    else width += 1;
  }
  return width;
}

function isCanvasTextBox(value: unknown): value is CanvasTextBox {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Partial<CanvasTextBox>;
  return (
    typeof item.text === 'string' &&
    typeof item.left === 'number' &&
    typeof item.top === 'number' &&
    typeof item.width === 'number' &&
    typeof item.height === 'number' &&
    (item.pageKey === undefined || typeof item.pageKey === 'string') &&
    Number.isFinite(item.left) &&
    Number.isFinite(item.top) &&
    Number.isFinite(item.width) &&
    Number.isFinite(item.height)
  );
}

function currentSheetsPageKey(): string {
  return `${location.pathname}?gid=${currentSheetsGid()}`;
}

function currentSheetsGid(): string {
  const searchGid = new URLSearchParams(location.search).get('gid');
  if (searchGid) return searchGid;
  const hash = location.hash.replace(/^#/, '');
  const hashGid = new URLSearchParams(hash).get('gid');
  return hashGid ?? '';
}
