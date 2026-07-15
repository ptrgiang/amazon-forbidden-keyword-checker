import type { KeywordMatcher } from '../lib/matcher';
import type { Violation } from '../lib/types';
import { isContentEditable } from './fields';
import { ViolationPopover } from './popover';
import { injectStyles } from './styles';

const PAGE_HIGHLIGHT_NAME = 'afkc-page-violation';
const MAX_TEXT_NODES = 2500;
const MAX_RANGES = 600;

const SKIP_SELECTOR = [
  '.afkc-popover',
  '.afkc-panel',
  '#afkc-overlay',
  '#afkc-docs-overlay',
  '#afkc-sheets-overlay',
  'script',
  'style',
  'noscript',
  'template',
  'textarea',
  'input',
  'select',
  '[contenteditable="true"]',
  '[aria-hidden="true"]'
].join(', ');

function supportsHighlightApi(): boolean {
  return typeof CSS !== 'undefined' && 'highlights' in CSS && 'Highlight' in globalThis;
}

function highlightRegistry(): Map<string, unknown> | null {
  if (!supportsHighlightApi()) return null;
  return (CSS as unknown as { highlights: Map<string, unknown> }).highlights;
}

function isVisibleTextHost(el: HTMLElement): boolean {
  if (el.closest(SKIP_SELECTOR)) return false;
  if (isContentEditable(el)) return false;
  const style = getComputedStyle(el);
  return style.display !== 'none' && style.visibility !== 'hidden';
}

function rangeForTextNode(node: Text, start: number, end: number): Range | null {
  if (start < 0 || end > node.data.length || start >= end) return null;
  const range = document.createRange();
  range.setStart(node, start);
  range.setEnd(node, end);
  return range;
}

interface PageTextHit {
  range: Range;
  violation: Violation;
}

/**
 * Highlights forbidden keywords in regular page text for normal websites.
 * Editable fields keep using ScanEngine; Docs/Sheets use their canvas scanners.
 */
export class PageTextScanner {
  private observer: MutationObserver | null = null;
  private timer: number | null = null;
  private running = false;
  private hits: PageTextHit[] = [];
  private popover = new ViolationPopover();

  constructor(private getMatcher: () => KeywordMatcher) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    injectStyles();
    this.observer = new MutationObserver(() => this.schedule(350));
    this.observer.observe(document.documentElement, {
      childList: true,
      characterData: true,
      subtree: true
    });
    document.addEventListener('mousemove', this.onMouseMove, true);
    document.addEventListener('keydown', this.onKeyDown, true);
    this.schedule(0);
    window.setTimeout(() => this.schedule(0), 500);
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.observer?.disconnect();
    this.observer = null;
    document.removeEventListener('mousemove', this.onMouseMove, true);
    document.removeEventListener('keydown', this.onKeyDown, true);
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.clear();
  }

  rescan(): void {
    if (this.running) this.schedule(0);
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
    const registry = highlightRegistry();
    const HighlightCtor = (globalThis as unknown as { Highlight?: new (...r: Range[]) => unknown })
      .Highlight;
    if (!registry || !HighlightCtor || !document.body) return;

    const matcher = this.getMatcher();
    const ranges: Range[] = [];
    const hits: PageTextHit[] = [];
    let checkedNodes = 0;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node): number {
        if (checkedNodes >= MAX_TEXT_NODES) return NodeFilter.FILTER_REJECT;
        const text = node.textContent ?? '';
        if (!text.trim()) return NodeFilter.FILTER_REJECT;
        const parent = node.parentElement;
        if (!parent || !isVisibleTextHost(parent)) return NodeFilter.FILTER_REJECT;
        checkedNodes += 1;
        return NodeFilter.FILTER_ACCEPT;
      }
    });

    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const textNode = node as Text;
      const violations = matcher.scan(textNode.data);
      for (const v of violations) {
        const range = rangeForTextNode(textNode, v.start, v.end);
        if (!range) continue;
        ranges.push(range);
        hits.push({ range, violation: v });
        if (ranges.length >= MAX_RANGES) break;
      }
      if (ranges.length >= MAX_RANGES) break;
    }

    registry.delete(PAGE_HIGHLIGHT_NAME);
    this.hits = hits;
    if (ranges.length > 0) {
      registry.set(PAGE_HIGHLIGHT_NAME, new HighlightCtor(...ranges) as never);
    }
  }

  private onMouseMove = (e: MouseEvent): void => {
    if (this.popover.contains(e.target)) {
      this.popover.cancelScheduledClose();
      return;
    }
    for (const hit of this.hits) {
      for (const rect of hit.range.getClientRects()) {
        if (e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom) {
          this.popover.open(hit.violation, new DOMRect(rect.left, rect.top, rect.width, rect.height));
          return;
        }
      }
    }
    this.popover.scheduleClose();
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') this.popover.close();
  };

  private clear(): void {
    this.hits = [];
    this.popover.close();
    highlightRegistry()?.delete(PAGE_HIGHLIGHT_NAME);
  }
}
