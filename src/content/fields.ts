/** Field discovery and eligibility rules. */

export type ValueField = HTMLInputElement | HTMLTextAreaElement;
export type EditableField = ValueField | HTMLElement;

const TEXT_INPUT_TYPES = new Set(['text', 'search', 'url', 'tel', 'email']);
const SENSITIVE_NAME = /pass(word)?|pwd|cvv|cvc|cc-?num|card.?number|pin\b|ssn|secret|otp/i;
const SENSITIVE_AUTOCOMPLETE = /^(cc-|current-password|new-password|one-time-code)/;

export function isValueField(el: Element): el is ValueField {
  return el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement;
}

export function isContentEditable(el: Element): el is HTMLElement {
  return el instanceof HTMLElement && el.isContentEditable;
}

export function isAriaTextbox(el: Element): el is HTMLElement {
  return el instanceof HTMLElement && el.getAttribute('role') === 'textbox';
}

function isEditableHost(el: Element): boolean {
  return isContentEditable(el) || isAriaTextbox(el);
}

/**
 * Should we scan this element? Excludes password/payment/hidden/disabled
 * fields and non-text input types.
 */
export function isScannable(el: Element): el is EditableField {
  if (el instanceof HTMLInputElement) {
    if (!TEXT_INPUT_TYPES.has(el.type)) return false;
    if (el.disabled || el.readOnly) return false;
    if (SENSITIVE_NAME.test(el.name) || SENSITIVE_NAME.test(el.id)) return false;
    if (SENSITIVE_AUTOCOMPLETE.test(el.autocomplete ?? '')) return false;
  } else if (el instanceof HTMLTextAreaElement) {
    if (el.disabled || el.readOnly) return false;
    if (SENSITIVE_NAME.test(el.name) || SENSITIVE_NAME.test(el.id)) return false;
  } else if (el instanceof HTMLElement) {
    if (!isEditableHost(el)) return false;
    if (el.getAttribute('aria-disabled') === 'true') return false;
    if (el.getAttribute('aria-readonly') === 'true') return false;
  } else {
    return false;
  }
  const style = getComputedStyle(el as HTMLElement);
  if (style.display === 'none' || style.visibility === 'hidden') return false;
  return true;
}

/** Find the editable host for an event target (closest CE root or the field). */
export function editableRootOf(target: EventTarget | null): EditableField | null {
  if (!(target instanceof Element)) return null;
  if (isValueField(target)) return isScannable(target) ? target : null;
  let editable = target instanceof HTMLElement ? target : target.parentElement;
  while (editable && !isEditableHost(editable)) {
    editable = editable.parentElement;
  }
  if (!editable) return null;
  // Walk up to the outermost editable root.
  let root = editable;
  let parent = root.parentElement;
  while (parent && isEditableHost(parent)) {
    root = parent;
    parent = root.parentElement;
  }
  return isScannable(root) ? root : null;
}

export function getFieldText(el: EditableField): string {
  if (isValueField(el)) return el.value;
  return getCeText(el).text;
}

export interface CeTextResult {
  text: string;
  /** Text nodes in order with their start offset in `text`. */
  nodes: { node: Text; start: number }[];
}

const BLOCKY = new Set([
  'DIV', 'P', 'LI', 'TR', 'BR', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'UL', 'OL', 'TABLE', 'BLOCKQUOTE', 'PRE'
]);

/**
 * Linearize a contenteditable's text nodes into one string, inserting a
 * newline at block boundaries so cross-block phrases don't falsely join.
 */
export function getCeText(root: HTMLElement): CeTextResult {
  let text = '';
  const nodes: { node: Text; start: number }[] = [];
  const walk = (el: Node): void => {
    for (let child = el.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === Node.TEXT_NODE) {
        nodes.push({ node: child as Text, start: text.length });
        text += (child as Text).data;
      } else if (child instanceof HTMLElement) {
        const tag = child.tagName;
        if (tag === 'SCRIPT' || tag === 'STYLE') continue;
        const isBlock = BLOCKY.has(tag) || getComputedStyle(child).display !== 'inline';
        if (isBlock && text.length > 0 && !text.endsWith('\n')) text += '\n';
        if (tag === 'BR') continue;
        walk(child);
        if (isBlock && text.length > 0 && !text.endsWith('\n')) text += '\n';
      }
    }
  };
  walk(root);
  return { text, nodes };
}

/** Build a DOM Range covering [start, end) in the linearized CE text. */
export function ceRange(root: HTMLElement, start: number, end: number): Range | null {
  const { nodes } = getCeText(root);
  let startNode: Text | null = null;
  let startOffset = 0;
  let endNode: Text | null = null;
  let endOffset = 0;
  for (const { node, start: ns } of nodes) {
    const ne = ns + node.data.length;
    if (startNode === null && start >= ns && start < ne) {
      startNode = node;
      startOffset = start - ns;
    }
    if (end > ns && end <= ne) {
      endNode = node;
      endOffset = end - ns;
    }
  }
  if (!startNode || !endNode) return null;
  const range = document.createRange();
  range.setStart(startNode, startOffset);
  range.setEnd(endNode, endOffset);
  return range;
}
