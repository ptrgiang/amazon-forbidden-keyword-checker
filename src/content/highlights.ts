import type { Violation } from '../lib/types';
import type { EditableField } from './fields';
import { ceRange, getFieldText, isValueField } from './fields';
import { editableTextRangeRects, valueFieldRangeRects } from './mirror';

export interface PlacedViolation {
  violation: Violation;
  field: EditableField;
  rects: DOMRect[];
}

export interface HighlightRendererOptions {
  preferOverlayForContentEditable?: boolean;
}

const HIGHLIGHT_NAME = 'afkc-violation';

function supportsHighlightApi(): boolean {
  return typeof CSS !== 'undefined' && 'highlights' in CSS;
}

/**
 * Renders violation highlights. Value fields get overlay boxes measured
 * via the mirror; contenteditable prefers the CSS Custom Highlight API
 * (non-destructive, tracks text exactly) with overlay boxes as fallback.
 * Nothing on the page is mutated.
 */
export class HighlightRenderer {
  private container: HTMLDivElement | null = null;
  private placed: PlacedViolation[] = [];
  /** CE ranges currently registered in the Highlight API. */
  private ceRanges: Range[] = [];

  constructor(private options: HighlightRendererOptions = {}) {}

  private getContainer(): HTMLDivElement {
    if (!this.container || !this.container.isConnected) {
      this.container = document.createElement('div');
      this.container.id = 'afkc-overlay';
      (document.body ?? document.documentElement).appendChild(this.container);
    }
    return this.container;
  }

  /** Recompute and redraw highlights for one field. */
  render(field: EditableField, violations: Violation[]): void {
    this.clearField(field);
    const text = getFieldText(field);
    const useHl =
      !isValueField(field) &&
      supportsHighlightApi() &&
      this.options.preferOverlayForContentEditable !== true;
    for (const v of violations) {
      let rects: DOMRect[] = [];
      const visualRange = trimVisualRange(text, v.start, v.end);
      if (!visualRange) continue;
      if (isValueField(field)) {
        rects = valueFieldRangeRects(field, visualRange.start, visualRange.end);
      } else if (this.options.preferOverlayForContentEditable === true) {
        rects = editableTextRangeRects(field, text, visualRange.start, visualRange.end);
      } else {
        const range = ceRange(field, visualRange.start, visualRange.end);
        if (range) {
          rects = rangeRects(range);
          if (useHl) this.ceRanges.push(range);
        }
      }
      this.placed.push({ violation: v, field, rects });
    }
    if (useHl) this.commitCeHighlights();
    this.drawBoxes();
  }

  private commitCeHighlights(): void {
    const registry = (CSS as unknown as { highlights: Map<string, unknown> }).highlights;
    if (this.ceRanges.length === 0) {
      registry.delete(HIGHLIGHT_NAME);
      return;
    }
    const HighlightCtor = (globalThis as unknown as { Highlight: new (...r: Range[]) => unknown })
      .Highlight;
    registry.set(HIGHLIGHT_NAME, new HighlightCtor(...this.ceRanges) as never);
  }

  /** Redraw all overlay boxes (value fields, and CE fallback). */
  drawBoxes(): void {
    const container = this.getContainer();
    container.textContent = '';
    const useHl = supportsHighlightApi();
    for (const p of this.placed) {
      // CE fields with Highlight API support don't need boxes.
      if (
        !isValueField(p.field) &&
        useHl &&
        this.options.preferOverlayForContentEditable !== true
      ) {
        continue;
      }
      for (const r of p.rects) {
        const box = document.createElement('div');
        box.className = 'afkc-hl';
        box.style.left = `${r.left}px`;
        box.style.top = `${r.top}px`;
        box.style.width = `${r.width}px`;
        box.style.height = `${r.height}px`;
        container.appendChild(box);
      }
    }
  }

  /** Re-measure every placed violation (after scroll/resize). */
  reflow(): void {
    const byField = new Map<EditableField, Violation[]>();
    for (const p of this.placed) {
      const list = byField.get(p.field) ?? [];
      list.push(p.violation);
      byField.set(p.field, list);
    }
    this.placed = [];
    this.ceRanges = [];
    for (const [field, violations] of byField) {
      if (!field.isConnected) continue;
      this.render(field, violations);
    }
  }

  clearField(field: EditableField): void {
    const keep = this.placed.filter((p) => p.field !== field);
    if (keep.length !== this.placed.length || this.placed.length === 0) {
      this.placed = keep;
      this.ceRanges = [];
      // Rebuild CE ranges for remaining fields.
      if (supportsHighlightApi() && this.options.preferOverlayForContentEditable !== true) {
        for (const p of this.placed) {
          if (!isValueField(p.field)) {
            const range = ceRange(p.field, p.violation.start, p.violation.end);
            if (range) this.ceRanges.push(range);
          }
        }
        this.commitCeHighlights();
      }
      this.drawBoxes();
    }
  }

  clearAll(): void {
    this.placed = [];
    this.ceRanges = [];
    if (supportsHighlightApi()) {
      (CSS as unknown as { highlights: Map<string, unknown> }).highlights.delete(HIGHLIGHT_NAME);
    }
    this.container?.remove();
    this.container = null;
  }

  /** Find the violation whose highlight box contains the point, if any. */
  hitTest(x: number, y: number): PlacedViolation | null {
    for (const p of this.placed) {
      for (const r of p.rects) {
        if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return p;
      }
    }
    return null;
  }

  violationsFor(field: EditableField): Violation[] {
    return this.placed.filter((p) => p.field === field).map((p) => p.violation);
  }
}

function trimVisualRange(text: string, start: number, end: number): { start: number; end: number } | null {
  let visualStart = start;
  let visualEnd = end;
  while (visualStart < visualEnd && /\s/.test(text[visualStart] ?? '')) visualStart += 1;
  while (visualEnd > visualStart && /\s/.test(text[visualEnd - 1] ?? '')) visualEnd -= 1;
  return visualStart < visualEnd ? { start: visualStart, end: visualEnd } : null;
}

function rangeRects(range: Range): DOMRect[] {
  const rects = [...range.getClientRects()]
    .map((r) => new DOMRect(r.left, r.top, r.width, r.height))
    .filter((r) => r.width > 0 && r.height > 0);
  if (rects.length > 0) return rects;
  const rect = range.getBoundingClientRect();
  if (rect.width > 0 && rect.height > 0) {
    return [new DOMRect(rect.left, rect.top, rect.width, rect.height)];
  }
  return [];
}
