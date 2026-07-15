import type { ValueField } from './fields';

/**
 * Measure where a character range renders on screen by mirroring its text into
 * a hidden, identically-styled element.
 */

const MIRROR_PROPS = [
  'boxSizing', 'width', 'height',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
  'fontFamily', 'fontSize', 'fontStyle', 'fontWeight', 'fontVariant',
  'lineHeight', 'letterSpacing', 'wordSpacing', 'textTransform',
  'textAlign', 'textIndent', 'whiteSpace', 'wordBreak', 'overflowWrap', 'tabSize', 'direction'
] as const;

let mirror: HTMLDivElement | null = null;

function getMirror(): HTMLDivElement {
  if (!mirror || !mirror.isConnected) {
    mirror = document.createElement('div');
    mirror.setAttribute('aria-hidden', 'true');
    mirror.style.position = 'fixed';
    mirror.style.top = '-10000px';
    mirror.style.left = '-10000px';
    mirror.style.visibility = 'hidden';
    mirror.style.pointerEvents = 'none';
    (document.body ?? document.documentElement).appendChild(mirror);
  }
  return mirror;
}

function applyMirrorStyle(m: HTMLDivElement, el: HTMLElement): CSSStyleDeclaration {
  const cs = getComputedStyle(el);
  for (const p of MIRROR_PROPS) {
    m.style[p as 'width'] = cs[p as 'width'];
  }
  return cs;
}

/**
 * Client rects (viewport coordinates) for text range [start, end) inside a
 * value field, accounting for the field's own scroll position.
 */
export function valueFieldRangeRects(el: ValueField, start: number, end: number): DOMRect[] {
  const m = getMirror();
  const cs = applyMirrorStyle(m, el);
  if (el instanceof HTMLInputElement) {
    // Single-line: never wrap.
    m.style.whiteSpace = 'pre';
    m.style.overflow = 'hidden';
  } else {
    m.style.whiteSpace = cs.whiteSpace === 'normal' ? 'pre-wrap' : cs.whiteSpace;
    m.style.overflow = 'hidden';
  }

  return mirrorTextRangeRects(m, el.value, start, end, el);
}

export function editableTextRangeRects(
  el: HTMLElement,
  text: string,
  start: number,
  end: number
): DOMRect[] {
  const m = getMirror();
  const cs = applyMirrorStyle(m, el);
  m.style.whiteSpace = cs.whiteSpace === 'normal' ? 'pre-wrap' : cs.whiteSpace;
  m.style.overflow = 'hidden';
  return mirrorTextRangeRects(m, text, start, end, el);
}

function mirrorTextRangeRects(
  m: HTMLDivElement,
  text: string,
  start: number,
  end: number,
  el: HTMLElement
): DOMRect[] {
  m.textContent = '';
  m.appendChild(document.createTextNode(text.slice(0, start)));
  const span = document.createElement('span');
  span.textContent = text.slice(start, end);
  m.appendChild(span);
  m.appendChild(document.createTextNode(text.slice(end) + '\u200b'));

  const mRect = m.getBoundingClientRect();
  const elRect = el.getBoundingClientRect();
  const rects: DOMRect[] = [];
  for (const r of span.getClientRects()) {
    rects.push(
      new DOMRect(
        r.left - mRect.left + elRect.left - el.scrollLeft,
        r.top - mRect.top + elRect.top - el.scrollTop,
        r.width,
        r.height
      )
    );
  }

  const clipTop = elRect.top;
  const clipBottom = elRect.bottom;
  const clipLeft = elRect.left;
  const clipRight = elRect.right;
  return rects
    .map((r) => {
      const top = Math.max(r.top, clipTop);
      const bottom = Math.min(r.bottom, clipBottom);
      const left = Math.max(r.left, clipLeft);
      const right = Math.min(r.right, clipRight);
      return new DOMRect(left, top, Math.max(0, right - left), Math.max(0, bottom - top));
    })
    .filter((r) => r.width > 0 && r.height > 0);
}
