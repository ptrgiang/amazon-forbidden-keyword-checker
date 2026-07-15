import { isValueField, type EditableField } from './fields';

/**
 * Site adapters tune how the generic engine behaves per site. The engine
 * itself is generic; adapters decide which fields are eligible.
 */
export interface SiteAdapter {
  name: 'standard' | 'amazon-seller-central' | 'google-sheets' | 'google-docs';
  /** Run the live-scan field engine on this page at all? */
  useFieldEngine: boolean;
  /** Extra veto for fields the engine finds. */
  fieldFilter?(el: EditableField): boolean;
}

const standardAdapter: SiteAdapter = {
  name: 'standard',
  useFieldEngine: true
};

/**
 * Amazon Seller Central: listing forms are standard inputs/textareas plus
 * some rich-text contenteditable editors, often inside iframes (the content
 * script runs in all frames). The generic engine covers them; the adapter
 * exists so future Seller-Central-specific rules have a home.
 */
const amazonAdapter: SiteAdapter = {
  name: 'amazon-seller-central',
  useFieldEngine: true
};

/**
 * Google Sheets: the grid is canvas, but the in-cell editor and the formula
 * bar are real contenteditable elements, so the field engine works on them
 * while a cell is being edited. The visible grid uses a separate scanner.
 */
const sheetsAdapter: SiteAdapter = {
  name: 'google-sheets',
  useFieldEngine: true,
  fieldFilter(el: EditableField): boolean {
    if (!(el instanceof HTMLElement)) return true;
    if (isValueField(el)) return true;
    return (
      el.isContentEditable ||
      el.classList.contains('cell-input') ||
      el.closest('#t-formula-bar-input, .cell-input, [role="textbox"]') !== null
    );
  }
};

/**
 * Google Docs renders the document on a canvas; the generic field engine
 * should not touch the hidden key-capture iframe. Docs uses a dedicated
 * annotated-canvas scanner instead.
 */
const docsAdapter: SiteAdapter = {
  name: 'google-docs',
  useFieldEngine: false
};

const ADAPTERS: Record<SiteAdapter['name'], SiteAdapter> = {
  standard: standardAdapter,
  'amazon-seller-central': amazonAdapter,
  'google-sheets': sheetsAdapter,
  'google-docs': docsAdapter
};

export function pickAdapter(loc: Location): SiteAdapter {
  // Test hook so harness pages can exercise site-specific adapters.
  const forced = (globalThis as { __afkcForceAdapter?: SiteAdapter['name'] }).__afkcForceAdapter;
  if (forced && ADAPTERS[forced]) return ADAPTERS[forced];
  const host = loc.hostname;
  const path = loc.pathname;
  if (host === 'docs.google.com') {
    if (path.startsWith('/spreadsheets')) return sheetsAdapter;
    if (path.startsWith('/document')) return docsAdapter;
    return standardAdapter;
  }
  if (/(^|\.)sellercentral(\.[a-z0-9-]+)*\.amazon(\.[a-z.]+)?$/i.test(host) || /sellercentral/.test(host)) {
    return amazonAdapter;
  }
  return standardAdapter;
}
