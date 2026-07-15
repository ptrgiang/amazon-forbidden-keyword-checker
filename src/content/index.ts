import { KeywordMatcher } from '../lib/matcher';
import { mergeKeywords } from '../lib/merge';
import { KEYS, isSiteEnabled, loadState, normalizeSettings } from '../lib/storage';
import type { LocalOverrides, RemoteDataset, Settings, Violation } from '../lib/types';
import { DEFAULT_SETTINGS, EMPTY_OVERRIDES } from '../lib/types';
import { pickAdapter } from './adapters';
import { DocsCanvasScanner } from './docsLive';
import { ScanEngine } from './engine';
import type { EditableField } from './fields';
import { editableRootOf, getCeText, isValueField } from './fields';
import { PageTextScanner } from './pageTextLive';
import { ViolationPanel } from './panel';
import { ViolationPopover } from './popover';
import { SheetsGridScanner } from './sheetsLive';
import { injectStyles } from './styles';

const contentWindow = window as Window & {
  __afkcContentBootstrapped?: boolean;
  __afkcRequestRescan?: () => void;
};
const alreadyBootstrapped = contentWindow.__afkcContentBootstrapped === true;
contentWindow.__afkcContentBootstrapped = true;
const SELECTION_HIGHLIGHT_NAME = 'afkc-selection-violation';
const BLOCK_TAGS = new Set([
  'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'BR', 'DD', 'DIV', 'DL', 'DT',
  'FIELDSET', 'FIGCAPTION', 'FIGURE', 'FOOTER', 'FORM', 'H1', 'H2', 'H3', 'H4',
  'H5', 'H6', 'HEADER', 'HR', 'LI', 'MAIN', 'NAV', 'OL', 'P', 'PRE', 'SECTION',
  'TABLE', 'TBODY', 'TD', 'TFOOT', 'TH', 'THEAD', 'TR', 'UL'
]);

interface SelectedTextSegment {
  node: Text;
  start: number;
  from: number;
  to: number;
}

interface SelectedTextMap {
  text: string;
  segments: SelectedTextSegment[];
}

interface SelectionHighlightController {
  enable(): void;
  disable(): void;
}

interface SelectionHit {
  range: Range;
  violation: Violation;
}

const adapter = pickAdapter(location);

let remote: RemoteDataset | null = null;
let overrides: LocalOverrides = EMPTY_OVERRIDES;
let settings: Settings = DEFAULT_SETTINGS;
let matcher = new KeywordMatcher([], null);
let extensionContextValid = true;

const panel = new ViolationPanel();

const engine = new ScanEngine({
  getMatcher: () => matcher,
  fieldFilter: adapter.fieldFilter,
  preferOverlayForContentEditable: adapter.name === 'google-sheets'
});

// Google Docs live scanner (annotated-canvas based), top frame only.
const docsScanner =
  adapter.name === 'google-docs' && window.top === window.self
    ? new DocsCanvasScanner(() => matcher)
    : null;
const sheetsScanner =
  adapter.name === 'google-sheets' && window.top === window.self
    ? new SheetsGridScanner(() => matcher)
    : null;
const pageTextScanner =
  adapter.name === 'standard' || adapter.name === 'amazon-seller-central'
    ? new PageTextScanner(() => matcher)
    : null;

function contextHostnames(): string[] {
  const hosts = new Set<string>();
  if (location.hostname) hosts.add(location.hostname);
  const ancestorOrigins = (location as Location & { ancestorOrigins?: DOMStringList })
    .ancestorOrigins;
  if (ancestorOrigins) {
    for (let i = 0; i < ancestorOrigins.length; i += 1) {
      try {
        hosts.add(new URL(ancestorOrigins.item(i) ?? '').hostname);
      } catch {
        // Ignore non-standard or unavailable ancestor origin values.
      }
    }
  }
  if (document.referrer) {
    try {
      hosts.add(new URL(document.referrer).hostname);
    } catch {
      // Referrer can be suppressed or non-HTTP.
    }
  }
  return [...hosts].filter(Boolean);
}

function isContextEnabled(): boolean {
  return contextHostnames().some((hostname) => isSiteEnabled(settings, hostname));
}

function rebuildMatcher(): void {
  const merged = mergeKeywords(remote, overrides);
  matcher = new KeywordMatcher(merged, settings.selectedLanguages);
}

function isExtensionContextInvalidated(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /extension context invalidated/i.test(message);
}

function deactivateInvalidatedContext(): void {
  if (!extensionContextValid) return;
  extensionContextValid = false;
  engine.stop();
  docsScanner?.stop();
  sheetsScanner?.stop();
  pageTextScanner?.stop();
  panel.close();
  window.removeEventListener('afkc.rescan', reloadAndApplyState);
  delete contentWindow.__afkcRequestRescan;
}

function applyEngineState(): void {
  if (!extensionContextValid) return;
  const enabled =
    isContextEnabled() &&
    settings.mode === 'live' &&
    adapter.useFieldEngine &&
    matcher.patternCount > 0;
  if (enabled) {
    injectStyles();
    engine.start();
    engine.refreshAll();
    requestAnimationFrame(() => engine.refreshAll());
    window.setTimeout(() => engine.refreshAll(), 250);
  } else {
    engine.stop();
  }
  if (docsScanner) {
    const docsEnabled =
      isContextEnabled() &&
      settings.mode === 'live' &&
      matcher.patternCount > 0;
    if (docsEnabled) {
      docsScanner.start();
      docsScanner.rescan();
    } else {
      docsScanner.stop();
    }
  }
  if (sheetsScanner) {
    const sheetsEnabled =
      isContextEnabled() &&
      settings.mode === 'live' &&
      matcher.patternCount > 0;
    if (sheetsEnabled) {
      sheetsScanner.start();
      sheetsScanner.rescan();
    } else {
      sheetsScanner.stop();
    }
  }
  if (pageTextScanner) {
    const pageEnabled =
      isContextEnabled() &&
      settings.mode === 'live' &&
      matcher.patternCount > 0;
    if (pageEnabled) {
      pageTextScanner.start();
      pageTextScanner.rescan();
    } else {
      pageTextScanner.stop();
    }
  }
}

function reloadAndApplyState(): void {
  if (!extensionContextValid) return;
  void loadState()
    .then((state) => {
      if (!extensionContextValid) return;
      remote = state.remote;
      overrides = state.overrides;
      settings = state.settings;
      rebuildMatcher();
      applyEngineState();
    })
    .catch((error: unknown) => {
      if (isExtensionContextInvalidated(error)) {
        deactivateInvalidatedContext();
        return;
      }
      console.error('[AFKC] Failed to load extension state.', error);
    });
}

function nearestBlock(el: Element | null): Element | null {
  let current = el;
  while (current && current !== document.documentElement) {
    if (BLOCK_TAGS.has(current.tagName) || getComputedStyle(current).display !== 'inline') {
      return current;
    }
    current = current.parentElement;
  }
  return current;
}

function shouldSeparateSegments(previous: SelectedTextSegment | undefined, nextNode: Text): boolean {
  if (!previous) return false;
  const prevText = previous.node.data.slice(previous.from, previous.to);
  const nextText = nextNode.data;
  if (!prevText || !nextText || /\s$/.test(prevText) || /^\s/.test(nextText)) return false;
  return nearestBlock(previous.node.parentElement) !== nearestBlock(nextNode.parentElement);
}

function selectedSegmentForRange(range: Range, node: Text): { from: number; to: number } | null {
  if (!range.intersectsNode(node)) return null;
  let from = 0;
  let to = node.data.length;
  if (range.startContainer === node) from = range.startOffset;
  if (range.endContainer === node) to = range.endOffset;
  if (from >= to) return null;
  return { from, to };
}

function appendSelectedTextNode(map: SelectedTextMap, range: Range, node: Text): void {
  const segment = selectedSegmentForRange(range, node);
  if (!segment) return;
  const value = node.data.slice(segment.from, segment.to);
  if (!value) return;
  const previous = map.segments[map.segments.length - 1];
  if (shouldSeparateSegments(previous, node)) {
    map.text += '\n';
  }
  map.segments.push({
    node,
    start: map.text.length,
    from: segment.from,
    to: segment.to
  });
  map.text += value;
}

function buildSelectedTextMap(selection: Selection): SelectedTextMap | null {
  const map: SelectedTextMap = { text: '', segments: [] };
  for (let i = 0; i < selection.rangeCount; i += 1) {
    const range = selection.getRangeAt(i);
    const root = range.commonAncestorContainer;
    if (root instanceof Text) {
      appendSelectedTextNode(map, range, root);
      continue;
    }
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      appendSelectedTextNode(map, range, node as Text);
    }
  }
  return map.segments.length > 0 ? map : null;
}

function rangeForSelectedText(map: SelectedTextMap, start: number, end: number): Range | null {
  let startSegment: SelectedTextSegment | undefined;
  let endSegment: SelectedTextSegment | undefined;
  for (const segment of map.segments) {
    const segmentEnd = segment.start + (segment.to - segment.from);
    if (!startSegment && start >= segment.start && start < segmentEnd) {
      startSegment = segment;
    }
    if (end > segment.start && end <= segmentEnd) {
      endSegment = segment;
      break;
    }
  }
  if (!startSegment || !endSegment) return null;
  const range = document.createRange();
  range.setStart(startSegment.node, startSegment.from + start - startSegment.start);
  range.setEnd(endSegment.node, endSegment.from + end - endSegment.start);
  return range;
}

function pointInRect(x: number, y: number, rect: DOMRect, pad = 0): boolean {
  return (
    x >= rect.left - pad &&
    x <= rect.right + pad &&
    y >= rect.top - pad &&
    y <= rect.bottom + pad
  );
}

/** DOM-range highlight for context-menu scans; caller owns enable/disable. */
function createSelectionHighlight(
  violations: Violation[],
  selectionMap: SelectedTextMap
): SelectionHighlightController | undefined {
  try {
    const registry = (CSS as unknown as { highlights?: Map<string, unknown> }).highlights;
    const HighlightCtor = (globalThis as unknown as { Highlight?: new (...r: Range[]) => unknown })
      .Highlight;
    if (!registry || !HighlightCtor) return undefined;
    const ranges: Range[] = [];
    const hits: SelectionHit[] = [];
    for (const v of violations) {
      const range = rangeForSelectedText(selectionMap, v.start, v.end);
      if (range) {
        ranges.push(range);
        hits.push({ range, violation: v });
      }
    }
    if (ranges.length === 0) return undefined;
    const popover = new ViolationPopover();
    let active = false;
    const onMouseMove = (e: MouseEvent): void => {
      if (popover.contains(e.target)) {
        popover.cancelScheduledClose();
        return;
      }
      for (const hit of hits) {
        if (!hit.range.commonAncestorContainer.isConnected) continue;
        for (const rect of hit.range.getClientRects()) {
          if (pointInRect(e.clientX, e.clientY, rect, 4)) {
            popover.open(hit.violation, new DOMRect(rect.left, rect.top, rect.width, rect.height));
            return;
          }
        }
      }
      popover.scheduleClose();
    };
    return {
      enable(): void {
        injectStyles();
        registry.delete(SELECTION_HIGHLIGHT_NAME);
        registry.set(SELECTION_HIGHLIGHT_NAME, new HighlightCtor(...ranges) as never);
        if (!active) {
          active = true;
          document.addEventListener('mousemove', onMouseMove, true);
        }
      },
      disable(): void {
        registry.delete(SELECTION_HIGHLIGHT_NAME);
        if (active) {
          active = false;
          document.removeEventListener('mousemove', onMouseMove, true);
        }
        popover.close();
      }
    };
  } catch {
    // Highlighting is best-effort; never break the page over it.
    return undefined;
  }
}

/** Handle right-click → "Scan selected text". */
function handleSelectionScan(selectionTextFromMenu: string | undefined): void {
  injectStyles();
  const sel = window.getSelection();
  const selectionMap =
    sel && sel.rangeCount > 0 && !sel.isCollapsed ? buildSelectedTextMap(sel) : null;
  const domSelection = selectionMap?.text ?? '';
  const field = sel ? editableRootOf(sel.anchorNode?.parentElement ?? null) : null;
  const activeField = editableRootOf(document.activeElement);
  if (sel && !sel.isCollapsed) {
    sel.removeAllRanges();
  }

  // Editable source: scan the whole field so corrections can be applied back.
  const editable: EditableField | null = field ?? activeField;
  if (editable) {
    const text = isValueField(editable) ? editable.value : getCeText(editable).text;
    const violations = matcher.scan(text);
    panel.open({
      title: 'Scan results (editable field)',
      violations
    });
    return;
  }

  const text = domSelection || selectionTextFromMenu || '';
  if (!text) {
    panel.open({ title: 'Scan results', violations: [] });
    return;
  }
  const violations = matcher.scan(text);
  const selectionHighlight = selectionMap
    ? createSelectionHighlight(violations, selectionMap)
    : undefined;
  selectionHighlight?.enable();
  panel.open({
    title: 'Scan results',
    violations,
    highlightToggle: selectionHighlight
      ? {
          checked: true,
          onToggle: (checked) => {
            if (checked) selectionHighlight.enable();
            else selectionHighlight.disable();
          }
        }
      : undefined,
    onClose: () => selectionHighlight?.disable()
  });
}

if (!alreadyBootstrapped) {
  contentWindow.__afkcRequestRescan = reloadAndApplyState;

  chrome.runtime.onMessage.addListener((message: { type?: string; text?: string }, _sender, sendResponse) => {
    if (!extensionContextValid) return false;
    if (message?.type === 'afkc.ping') {
      sendResponse({ ok: true });
      return false;
    }
    if (message?.type === 'afkc.scanSelection') {
      handleSelectionScan(message.text);
    }
    if (message?.type === 'afkc.rescan') {
      reloadAndApplyState();
    }
    return false;
  });

  window.addEventListener('afkc.rescan', reloadAndApplyState);

  chrome.storage.onChanged.addListener((changes, area) => {
    if (!extensionContextValid) return;
    if (area !== 'local') return;
    let dirty = false;
    if (KEYS.remote in changes) {
      remote = (changes[KEYS.remote].newValue as RemoteDataset | undefined) ?? null;
      dirty = true;
    }
    if (KEYS.overrides in changes) {
      overrides = {
        ...EMPTY_OVERRIDES,
        ...(changes[KEYS.overrides].newValue as LocalOverrides | undefined)
      };
      dirty = true;
    }
    if (KEYS.settings in changes) {
      settings = normalizeSettings(changes[KEYS.settings].newValue as Partial<Settings> | undefined);
      dirty = true;
    }
    if (dirty) {
      rebuildMatcher();
      applyEngineState();
      engine.rescanAll();
    }
  });

  reloadAndApplyState();
}
