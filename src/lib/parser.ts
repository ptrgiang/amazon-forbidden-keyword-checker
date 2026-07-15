import { cleanTerm, termKey } from './normalize';
import type { RemoteKeyword } from './types';

export interface ParsedSheet {
  languages: string[];
  keywords: RemoteKeyword[];
}

/**
 * Parse a column-based multilingual sheet:
 * row 1 = language names, every non-empty cell below a valid header is a
 * forbidden keyword for that language. Blank columns/cells are ignored,
 * duplicates are removed per language, and a term appearing in several
 * columns keeps all its language labels.
 */
export function parseKeywordGrid(rows: (string | number | null | undefined)[][]): ParsedSheet {
  if (!rows || rows.length === 0) {
    throw new Error('Sheet is empty');
  }
  const header = rows[0] ?? [];
  const columns: { index: number; language: string }[] = [];
  const seenLangs = new Set<string>();
  for (let c = 0; c < header.length; c++) {
    const raw = header[c];
    if (raw === null || raw === undefined) continue;
    const lang = cleanTerm(String(raw));
    if (!lang) continue;
    // A duplicate header column merges into the first occurrence.
    columns.push({ index: c, language: lang });
    seenLangs.add(lang);
  }
  if (columns.length === 0) {
    throw new Error('Sheet has no language headers in row 1');
  }

  // key -> { term, languages }
  const byKey = new Map<string, { term: string; languages: Set<string> }>();
  const languagesWithTerms = new Set<string>();

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row) continue;
    for (const col of columns) {
      const raw = row[col.index];
      if (raw === null || raw === undefined) continue;
      const term = cleanTerm(String(raw));
      if (!term) continue;
      const key = termKey(term);
      let entry = byKey.get(key);
      if (!entry) {
        entry = { term, languages: new Set() };
        byKey.set(key, entry);
      }
      entry.languages.add(col.language);
      languagesWithTerms.add(col.language);
    }
  }

  if (byKey.size === 0) {
    throw new Error('Sheet contained no keywords');
  }

  const keywords: RemoteKeyword[] = [];
  for (const [key, { term, languages }] of byKey) {
    keywords.push({ term, key, languages: [...languages] });
  }
  // Report every declared language (even currently empty ones stay listed
  // only if they have terms; fully blank columns are ignored per spec).
  const languages = [...seenLangs].filter((l) => languagesWithTerms.has(l));
  return { languages, keywords };
}

/**
 * Sniff whether a downloaded payload is actually a Google login/error HTML
 * page rather than spreadsheet data.
 */
export function looksLikeHtml(bytes: ArrayBuffer): boolean {
  const head = new TextDecoder('utf-8', { fatal: false })
    .decode(bytes.slice(0, 512))
    .trimStart()
    .toLowerCase();
  return (
    head.startsWith('<!doctype html') ||
    head.startsWith('<html') ||
    head.includes('<title>google') ||
    head.includes('accounts.google.com')
  );
}
