import { KeywordMatcher } from '../lib/matcher';
import type { Violation } from '../lib/types';
import type { EditableField } from './fields';
import { editableRootOf, getFieldText, isScannable } from './fields';
import { HighlightRenderer } from './highlights';
import { ViolationPopover } from './popover';

const DEBOUNCE_MS = 80;
const EDITABLE_SELECTOR = 'input, textarea, [contenteditable], [role="textbox"]';

export interface EngineDeps {
  getMatcher(): KeywordMatcher;
  /** Adapter hook: veto specific fields (e.g. Docs internals). */
  fieldFilter?(el: EditableField): boolean;
  preferOverlayForContentEditable?: boolean;
}

interface FieldState {
  timer: number | null;
  lastText: string;
}

/**
 * Live Scan engine: watches editable fields, scans them (debounced) and
 * renders non-destructive highlights. Uses event delegation + one
 * MutationObserver, so dynamically created editors are supported without
 * per-element listeners.
 */
export class ScanEngine {
  private renderer: HighlightRenderer;
  private popover = new ViolationPopover();
  private fields = new Map<EditableField, FieldState>();
  private observer: MutationObserver | null = null;
  private reflowScheduled = false;
  private running = false;

  constructor(private deps: EngineDeps) {
    this.renderer = new HighlightRenderer({
      preferOverlayForContentEditable: deps.preferOverlayForContentEditable === true
    });
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    document.addEventListener('focusin', this.onFocusIn, true);
    document.addEventListener('input', this.onInput, true);
    document.addEventListener('beforeinput', this.onInput, true);
    document.addEventListener('keyup', this.onInput, true);
    document.addEventListener('compositionend', this.onInput, true);
    document.addEventListener('paste', this.onInput, true);
    document.addEventListener('selectionchange', this.onSelectionChange, true);
    document.addEventListener('scroll', this.onScrollOrResize, true);
    window.addEventListener('resize', this.onScrollOrResize);
    document.addEventListener('mousemove', this.onMouseMove, true);
    this.observer = new MutationObserver(this.onMutations);
    this.observer.observe(document.documentElement, {
      childList: true,
      characterData: true,
      subtree: true
    });
    // Scan whatever is already focused.
    const active = document.activeElement;
    if (active) {
      const field = editableRootOf(active);
      if (field) this.scheduleScan(field, 0);
    }
    this.discoverFields(document, 0);
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    document.removeEventListener('focusin', this.onFocusIn, true);
    document.removeEventListener('input', this.onInput, true);
    document.removeEventListener('beforeinput', this.onInput, true);
    document.removeEventListener('keyup', this.onInput, true);
    document.removeEventListener('compositionend', this.onInput, true);
    document.removeEventListener('paste', this.onInput, true);
    document.removeEventListener('selectionchange', this.onSelectionChange, true);
    document.removeEventListener('scroll', this.onScrollOrResize, true);
    window.removeEventListener('resize', this.onScrollOrResize);
    document.removeEventListener('mousemove', this.onMouseMove, true);
    this.observer?.disconnect();
    this.observer = null;
    for (const state of this.fields.values()) {
      if (state.timer !== null) clearTimeout(state.timer);
    }
    this.fields.clear();
    this.renderer.clearAll();
    this.popover.close();
  }

  /** Re-scan every tracked field (after keyword/settings updates). */
  rescanAll(): void {
    if (!this.running) return;
    for (const field of [...this.fields.keys()]) {
      if (!field.isConnected) {
        this.dropField(field);
        continue;
      }
      this.scheduleScan(field, 0);
    }
  }

  /** Discover current editors and re-scan them, including dynamically inserted fields. */
  refreshAll(delay = 0): void {
    if (!this.running) return;
    this.discoverFields(document, delay);
    this.rescanAll();
  }

  private track(field: EditableField): FieldState {
    let state = this.fields.get(field);
    if (!state) {
      state = { timer: null, lastText: '' };
      this.fields.set(field, state);
    }
    return state;
  }

  private dropField(field: EditableField): void {
    const state = this.fields.get(field);
    if (state?.timer != null) clearTimeout(state.timer);
    this.fields.delete(field);
    this.renderer.clearField(field);
  }

  private onFocusIn = (e: FocusEvent): void => {
    const field = this.resolveEventField(e);
    if (field) this.scheduleScan(field, 0);
  };

  private onInput = (e: Event): void => {
    const field = this.resolveEventField(e);
    if (field) this.scheduleScan(field, DEBOUNCE_MS);
  };

  private onSelectionChange = (): void => {
    const active = document.activeElement;
    const field = active ? this.resolveField(active) : null;
    if (field) this.scheduleScan(field, DEBOUNCE_MS);
  };

  private resolveEventField(event: Event): EditableField | null {
    for (const target of event.composedPath()) {
      const field = this.resolveField(target);
      if (field) return field;
    }
    return this.resolveField(event.target);
  }

  private resolveField(target: EventTarget | null): EditableField | null {
    const field = editableRootOf(target);
    if (!field) return null;
    if (this.deps.fieldFilter && !this.deps.fieldFilter(field)) return null;
    return field;
  }

  private discoverFields(root: ParentNode, delay: number): void {
    const candidates = new Set<Element>();
    if (root instanceof Element && root.matches(EDITABLE_SELECTOR)) {
      candidates.add(root);
    }
    for (const el of root.querySelectorAll(EDITABLE_SELECTOR)) {
      candidates.add(el);
    }
    for (const candidate of candidates) {
      const field = this.resolveField(candidate);
      if (field) this.scheduleScan(field, delay);
    }
  }

  private onScrollOrResize = (): void => {
    if (this.reflowScheduled) return;
    this.reflowScheduled = true;
    requestAnimationFrame(() => {
      this.reflowScheduled = false;
      this.renderer.reflow();
    });
  };

  private onMutations = (records: MutationRecord[]): void => {
    let removedTracked = false;
    const changedTracked = new Set<EditableField>();
    for (const rec of records) {
      const target = rec.target;
      if (rec.type === 'childList') {
        for (const node of rec.addedNodes) {
          if (node instanceof Element) this.discoverFields(node, DEBOUNCE_MS);
        }
      }
      for (const field of this.fields.keys()) {
        if (target === field || (target instanceof Node && field.contains(target))) {
          changedTracked.add(field);
        }
      }
      for (const node of rec.removedNodes) {
        if (!(node instanceof Element)) continue;
        for (const field of this.fields.keys()) {
          if (node === field || node.contains(field)) {
            removedTracked = true;
          }
        }
      }
    }
    if (removedTracked) {
      for (const field of [...this.fields.keys()]) {
        if (!field.isConnected) this.dropField(field);
      }
    }
    for (const field of changedTracked) {
      if (field.isConnected) this.scheduleScan(field, DEBOUNCE_MS);
    }
  };

  private onMouseMove = (e: MouseEvent): void => {
    if (this.popover.contains(e.target)) {
      this.popover.cancelScheduledClose();
      return;
    }
    const hit = this.renderer.hitTest(e.clientX, e.clientY);
    if (!hit) {
      this.popover.scheduleClose();
      return;
    }
    const rect = hit.rects[0] ?? new DOMRect(e.clientX, e.clientY, 0, 0);
    this.popover.open(hit.violation, rect);
  };

  private scheduleScan(field: EditableField, delay: number): void {
    const state = this.track(field);
    if (state.timer !== null) clearTimeout(state.timer);
    state.timer = setTimeout(() => {
      state.timer = null;
      this.scanNow(field);
    }, delay) as unknown as number;
  }

  private scanNow(field: EditableField): void {
    if (!field.isConnected || !isScannable(field)) {
      this.dropField(field);
      return;
    }
    const state = this.track(field);
    const text = getFieldText(field);
    if (text !== state.lastText) {
      state.lastText = text;
    }
    const violations = this.deps.getMatcher().scan(text);
    this.renderer.render(field, violations);
  }

  /** Current violations for the focused field (used by adapters/panels). */
  violationsFor(field: EditableField): Violation[] {
    return this.renderer.violationsFor(field);
  }
}
